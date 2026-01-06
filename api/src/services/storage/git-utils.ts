/**
 * Git utilities for storage operations
 * Wraps git CLI commands
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export interface GitInfo {
	repoRoot: string;
	branch: string;
	remoteUrl: string | null;
}

// Default timeout for git operations (30 seconds)
const DEFAULT_GIT_TIMEOUT_MS = 30000;

/**
 * Execute a git command in a directory
 * Uses spawn with args array to prevent command injection
 */
export async function execGit(
	cwd: string,
	args: string[],
	options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
	const timeout = options?.timeout ?? DEFAULT_GIT_TIMEOUT_MS;

	return new Promise((resolve, reject) => {
		const proc: ChildProcess = spawn('git', args, { cwd });

		let stdout = '';
		let stderr = '';
		let killed = false;

		const timer = setTimeout(() => {
			killed = true;
			proc.kill('SIGTERM');
			reject(new Error(`Git command timed out after ${timeout}ms`));
		}, timeout);

		proc.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('error', (error: Error) => {
			clearTimeout(timer);
			reject(new Error(`Git command failed: ${error.message}`));
		});

		proc.on('close', (code: number | null) => {
			clearTimeout(timer);
			if (killed) return; // Already rejected by timeout
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`Git command failed: ${stderr || `exit code ${code}`}`));
			}
		});
	});
}

/**
 * Find the git repository root for a given path
 * Returns null if not in a git repository
 */
export async function findRepoRoot(folderPath: string): Promise<string | null> {
	try {
		const { stdout } = await execGit(folderPath, ['rev-parse', '--show-toplevel']);
		return stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
	const { stdout } = await execGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
	return stdout.trim();
}

/**
 * Get the remote origin URL
 */
export async function getRemoteUrl(repoPath: string): Promise<string | null> {
	try {
		const { stdout } = await execGit(repoPath, ['remote', 'get-url', 'origin']);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Get full git info for a path
 */
export async function getGitInfo(folderPath: string): Promise<GitInfo | null> {
	const repoRoot = await findRepoRoot(folderPath);
	if (!repoRoot) {
		return null;
	}

	const branch = await getCurrentBranch(repoRoot);
	const remoteUrl = await getRemoteUrl(repoRoot);

	return { repoRoot, branch, remoteUrl };
}

/**
 * Calculate relative path within repository
 */
export function getRelativePath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	// Normalize to forward slashes and ensure leading slash
	const normalized = '/' + relative.replace(/\\/g, '/');
	return normalized === '/.' ? '/' : normalized;
}

/**
 * Validate that a path is within the repository (prevent path traversal)
 * Uses realpath to resolve symlinks and prevent symlink-based attacks
 */
export async function validatePath(repoRoot: string, relativePath: string): Promise<string> {
	const absolutePath = path.resolve(repoRoot, relativePath.replace(/^\//, ''));

	// Resolve symlinks in both paths for secure comparison
	let realRepoRoot: string;
	let realAbsolutePath: string;

	try {
		realRepoRoot = await fs.realpath(repoRoot);
	} catch {
		throw new Error('Repository root not accessible');
	}

	try {
		realAbsolutePath = await fs.realpath(absolutePath);
	} catch {
		// Path doesn't exist yet (e.g., for write operations)
		// Fall back to checking the parent directory
		const parentPath = path.dirname(absolutePath);
		try {
			const realParent = await fs.realpath(parentPath);
			// Ensure path separator boundary to prevent /repo matching /repo-other
			const repoRootWithSep = realRepoRoot.endsWith(path.sep) ? realRepoRoot : realRepoRoot + path.sep;
			if (realParent !== realRepoRoot && !realParent.startsWith(repoRootWithSep)) {
				throw new Error('Path traversal detected');
			}
		} catch {
			// Parent doesn't exist either - just do the basic check
			const normalizedRepo = path.normalize(repoRoot);
			const normalizedRepoWithSep = normalizedRepo.endsWith(path.sep) ? normalizedRepo : normalizedRepo + path.sep;
			if (absolutePath !== normalizedRepo && !absolutePath.startsWith(normalizedRepoWithSep)) {
				throw new Error('Path traversal detected');
			}
		}
		return absolutePath;
	}

	// Ensure path separator boundary to prevent /repo matching /repo-other
	const repoRootWithSep = realRepoRoot.endsWith(path.sep) ? realRepoRoot : realRepoRoot + path.sep;
	if (realAbsolutePath !== realRepoRoot && !realAbsolutePath.startsWith(repoRootWithSep)) {
		throw new Error('Path traversal detected');
	}

	return absolutePath;
}
