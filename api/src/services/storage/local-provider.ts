/**
 * LocalStorageProvider - reads/writes from local filesystem
 * Used for local development mode
 */

import fs from 'fs/promises';
import path from 'path';
import {
	STORAGE_LIMITS,
	type StorageProvider,
	type FileEntry,
	type ListDirectoryOptions,
	type GitStatus,
	type FileChange,
	type Commit,
	type PullResult,
} from './types.js';
import { execGit, validatePath } from './git-utils.js';

export class LocalStorageProvider implements StorageProvider {
	constructor(private repoPath: string) {}

	// ─────────────────────────────────────────────────────────────────────────
	// File operations
	// ─────────────────────────────────────────────────────────────────────────

	async listDirectory(relativePath: string, options?: ListDirectoryOptions): Promise<FileEntry[]> {
		const absolutePath = await validatePath(this.repoPath, relativePath);
		const { showHidden = false, extensions } = options ?? {};

		const entries = await fs.readdir(absolutePath, { withFileTypes: true });

		// Filter hidden files unless showHidden is true
		const visibleEntries = showHidden
			? entries
			: entries.filter((e) => !e.name.startsWith('.'));

		const results = await Promise.all(
			visibleEntries.map(async (entry): Promise<FileEntry | null> => {
				const entryPath = path.join(absolutePath, entry.name);
				const entryRelPath = path.join(relativePath, entry.name).replace(/\\/g, '/');
				const normalizedPath = entryRelPath.startsWith('/') ? entryRelPath : '/' + entryRelPath;

				if (entry.isDirectory()) {
					return {
						name: entry.name,
						path: normalizedPath,
						type: 'directory',
					};
				} else if (entry.isFile()) {
					// Apply extension filter if specified
					if (extensions && extensions.length > 0) {
						const ext = path.extname(entry.name).toLowerCase().slice(1); // Remove leading dot
						if (!ext || !extensions.includes(ext)) {
							return null;
						}
					}
					const stats = await fs.stat(entryPath);
					return {
						name: entry.name,
						path: normalizedPath,
						type: 'file',
						size: stats.size,
						modifiedAt: stats.mtime,
					};
				}
				return null;
			})
		);

		// Filter nulls and sort: directories first, then alphabetically
		const sorted = results
			.filter((r): r is FileEntry => r !== null)
			.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

		// Enforce file limit
		if (sorted.length > STORAGE_LIMITS.MAX_FILES_PER_LISTING) {
			throw new Error('TOO_MANY_FILES');
		}

		return sorted;
	}

	async readFile(relativePath: string): Promise<string> {
		const absolutePath = await validatePath(this.repoPath, relativePath);

		// Only allow markdown files
		const ext = path.extname(relativePath).toLowerCase();
		if (ext !== '.md' && ext !== '.mdx') {
			throw new Error('BINARY_FILE');
		}

		// Check file size before reading
		const stats = await fs.stat(absolutePath);
		if (stats.size > STORAGE_LIMITS.MAX_FILE_SIZE_BYTES) {
			throw new Error('FILE_TOO_LARGE');
		}

		return fs.readFile(absolutePath, 'utf-8');
	}

	async writeFile(relativePath: string, content: string): Promise<void> {
		const absolutePath = await validatePath(this.repoPath, relativePath);
		await fs.writeFile(absolutePath, content, 'utf-8');
	}

	async deleteFile(relativePath: string): Promise<void> {
		const absolutePath = await validatePath(this.repoPath, relativePath);
		await fs.rm(absolutePath, { recursive: true });
	}

	async createDirectory(relativePath: string): Promise<void> {
		const absolutePath = await validatePath(this.repoPath, relativePath);
		await fs.mkdir(absolutePath, { recursive: true });
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const oldAbsolute = await validatePath(this.repoPath, oldPath);
		const newAbsolute = await validatePath(this.repoPath, newPath);
		await fs.rename(oldAbsolute, newAbsolute);
	}

	async exists(relativePath: string): Promise<boolean> {
		try {
			const absolutePath = await validatePath(this.repoPath, relativePath);
			await fs.access(absolutePath);
			return true;
		} catch {
			return false;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Git operations
	// ─────────────────────────────────────────────────────────────────────────

	async status(): Promise<GitStatus> {
		const { stdout } = await execGit(this.repoPath, ['status', '--porcelain', '-b']);
		const lines = stdout.trim().split('\n').filter(Boolean);

		let branch = 'unknown';
		let ahead = 0;
		let behind = 0;
		const staged: FileChange[] = [];
		const unstaged: FileChange[] = [];
		const untracked: string[] = [];

		for (const line of lines) {
			if (line.startsWith('##')) {
				// Parse branch info: ## main...origin/main [ahead 1, behind 2]
				const branchMatch = line.match(/^## (\S+)/);
				if (branchMatch) {
					branch = branchMatch[1]!.split('...')[0]!;
				}
				const aheadMatch = line.match(/ahead (\d+)/);
				if (aheadMatch) ahead = parseInt(aheadMatch[1]!, 10);
				const behindMatch = line.match(/behind (\d+)/);
				if (behindMatch) behind = parseInt(behindMatch[1]!, 10);
				continue;
			}

			// Ensure line has minimum length and expected format for status parsing (XY path format)
			// Format: XY<space>path - need at least 4 chars and space at position 2
			if (line.length < 4 || line[2] !== ' ') {
				continue;
			}

			const indexStatus = line[0];
			const workTreeStatus = line[1];
			const filePath = line.slice(3);
			if (!filePath) {
				continue;
			}

			// Staged changes (index)
			if (indexStatus && indexStatus !== ' ' && indexStatus !== '?') {
				staged.push({
					path: '/' + filePath,
					status: this.parseStatus(indexStatus),
				});
			}

			// Unstaged changes (work tree)
			if (workTreeStatus && workTreeStatus !== ' ' && workTreeStatus !== '?') {
				unstaged.push({
					path: '/' + filePath,
					status: this.parseStatus(workTreeStatus),
				});
			}

			// Untracked
			if (indexStatus === '?' && workTreeStatus === '?') {
				untracked.push('/' + filePath);
			}
		}

		return { branch, ahead, behind, staged, unstaged, untracked };
	}

	private parseStatus(char: string): FileChange['status'] {
		switch (char) {
			case 'A':
				return 'added';
			case 'M':
				return 'modified';
			case 'D':
				return 'deleted';
			case 'R':
				return 'renamed';
			case 'C': // Copied - treat as modified for our model
			case 'T': // Type change (file <-> symlink) - treat as modified
			case 'U': // Unmerged - treat as modified
			default:
				return 'modified';
		}
	}

	async log(options?: { limit?: number; path?: string }): Promise<Commit[]> {
		// Use null byte as delimiter to handle special characters in commit messages
		const args = ['log', '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI', `-n${options?.limit ?? 20}`];
		if (options?.path) {
			args.push('--', options.path.replace(/^\//, ''));
		}

		const { stdout } = await execGit(this.repoPath, args);
		const lines = stdout.trim().split('\n').filter(Boolean);

		return lines.map((line) => {
			// Format: sha\0shortSha\0message\0authorName\0authorEmail\0dateStr
			const parts = line.split('\x00');
			if (parts.length !== 6) {
				throw new Error(`Unexpected git log format: expected 6 fields, got ${parts.length}`);
			}
			const [sha, shortSha, message, authorName, authorEmail, dateStr] = parts;

			return {
				sha: sha!,
				shortSha: shortSha!,
				message: message!,
				author: { name: authorName!, email: authorEmail! },
				date: new Date(dateStr!),
			};
		});
	}

	async add(paths: string[]): Promise<void> {
		const relativePaths = paths.map((p) => p.replace(/^\//, ''));
		await execGit(this.repoPath, ['add', ...relativePaths]);
	}

	async commit(message: string): Promise<string> {
		await execGit(this.repoPath, ['commit', '-m', message]);
		const { stdout } = await execGit(this.repoPath, ['rev-parse', 'HEAD']);
		return stdout.trim();
	}

	async push(): Promise<void> {
		await execGit(this.repoPath, ['push']);
	}

	async pull(): Promise<PullResult> {
		try {
			// Get current HEAD before pulling to count commits
			const { stdout: oldHead } = await execGit(this.repoPath, ['rev-parse', 'HEAD']);
			const oldSha = oldHead.trim();

			const { stdout } = await execGit(this.repoPath, ['pull']);

			// Check for conflicts
			const conflicts: string[] = [];
			if (stdout.includes('CONFLICT')) {
				const { stdout: statusOut } = await execGit(this.repoPath, ['status', '--porcelain']);
				for (const line of statusOut.split('\n')) {
					if (line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD')) {
						conflicts.push('/' + line.slice(3));
					}
				}
			}

			// Count commits pulled using rev-list
			let commits = 0;
			try {
				const { stdout: newHead } = await execGit(this.repoPath, ['rev-parse', 'HEAD']);
				const newSha = newHead.trim();
				if (oldSha !== newSha) {
					const { stdout: countOut } = await execGit(this.repoPath, [
						'rev-list', '--count', `${oldSha}..${newSha}`,
					]);
					commits = parseInt(countOut.trim(), 10) || 0;
				}
			} catch {
				// Fall back to 0 if rev-list fails
				commits = 0;
			}

			return { pulled: true, commits, conflicts };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('CONFLICT')) {
				return { pulled: false, commits: 0, conflicts: [message] };
			}
			throw error;
		}
	}

	async getCurrentBranch(): Promise<string> {
		const { stdout } = await execGit(this.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
		return stdout.trim();
	}

	async getRemoteUrl(): Promise<string | null> {
		try {
			const { stdout } = await execGit(this.repoPath, ['remote', 'get-url', 'origin']);
			return stdout.trim() || null;
		} catch {
			return null;
		}
	}

	async restore(relativePath: string): Promise<void> {
		// Remove leading slash for git command
		const gitPath = relativePath.replace(/^\//, '');
		await execGit(this.repoPath, ['checkout', 'HEAD', '--', gitPath]);
	}
}
