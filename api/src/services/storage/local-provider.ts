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
} from './types.js';
import { validatePath } from './git-utils.js';

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
						const ext = entry.name.toLowerCase().split('.').pop();
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
}
