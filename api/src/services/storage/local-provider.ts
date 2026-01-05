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

	async listDirectory(relativePath: string): Promise<FileEntry[]> {
		const absolutePath = validatePath(this.repoPath, relativePath);

		const entries = await fs.readdir(absolutePath, { withFileTypes: true });

		// Filter hidden files and build entry info in parallel
		const visibleEntries = entries.filter((e) => !e.name.startsWith('.'));

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
		const absolutePath = validatePath(this.repoPath, relativePath);

		// Check for common binary extensions
		const binaryExtensions = new Set([
			'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
			'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
			'.zip', '.tar', '.gz', '.rar', '.7z',
			'.exe', '.dll', '.so', '.dylib',
			'.woff', '.woff2', '.ttf', '.eot', '.otf',
			'.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
		]);
		const ext = path.extname(relativePath).toLowerCase();
		if (binaryExtensions.has(ext)) {
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
		const absolutePath = validatePath(this.repoPath, relativePath);
		await fs.writeFile(absolutePath, content, 'utf-8');
	}

	async deleteFile(relativePath: string): Promise<void> {
		const absolutePath = validatePath(this.repoPath, relativePath);
		await fs.rm(absolutePath, { recursive: true });
	}

	async createDirectory(relativePath: string): Promise<void> {
		const absolutePath = validatePath(this.repoPath, relativePath);
		await fs.mkdir(absolutePath, { recursive: true });
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const oldAbsolute = validatePath(this.repoPath, oldPath);
		const newAbsolute = validatePath(this.repoPath, newPath);
		await fs.rename(oldAbsolute, newAbsolute);
	}

	async exists(relativePath: string): Promise<boolean> {
		try {
			const absolutePath = validatePath(this.repoPath, relativePath);
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

			const indexStatus = line[0];
			const workTreeStatus = line[1];
			const filePath = line.slice(3);

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
			default:
				return 'modified';
		}
	}

	async log(options?: { limit?: number; path?: string }): Promise<Commit[]> {
		const args = ['log', '--format=%H|%h|%s|%an|%ae|%aI', `-n${options?.limit ?? 20}`];
		if (options?.path) {
			args.push('--', options.path.replace(/^\//, ''));
		}

		const { stdout } = await execGit(this.repoPath, args);
		const lines = stdout.trim().split('\n').filter(Boolean);

		return lines.map((line) => {
			const [sha, shortSha, message, authorName, authorEmail, dateStr] = line.split('|');
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

			// Count commits pulled
			let commits = 0;
			const match = stdout.match(/(\d+) files? changed/);
			if (match) commits = 1; // At least one commit if files changed
			const commitMatch = stdout.match(/(\d+) commits?/);
			if (commitMatch) commits = parseInt(commitMatch[1]!, 10);

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
}
