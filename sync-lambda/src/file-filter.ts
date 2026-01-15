/**
 * File filtering for GitHub sync.
 * Determines which files to sync based on directory, size, and content.
 */

import { isBinaryFile } from 'isbinaryfile';

// Maximum file size to sync (500KB)
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

// Directories to always skip (without trailing slashes for boundary matching)
const SKIP_DIRECTORIES = [
	'node_modules',
	'.git',
	'vendor',
	'dist',
	'build',
	'__pycache__',
	'.next',
	'.nuxt',
	'.cache',
	'coverage',
	'.pytest_cache',
	'.mypy_cache',
	'target', // Rust
	'bin', // Go
	'obj', // .NET
	'.gradle',
	'.idea',
	'.vscode',
];

/**
 * Check if a path should be skipped because it's in a skip directory.
 * Uses boundary checking to avoid matching partial directory names
 * (e.g., 'node_modules' won't match 'mynode_modules').
 */
export function shouldSkipDirectory(path: string): boolean {
	const normalizedPath = path.startsWith('/') ? path.substring(1) : path;

	for (const dir of SKIP_DIRECTORIES) {
		// Check for exact directory match at path boundaries
		// Must be at start or after '/', and followed by '/' or end of string
		const pattern = new RegExp(`(^|/)${dir}(/|$)`);
		if (pattern.test(normalizedPath)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if content is binary using isbinaryfile.
 */
export async function isBinary(buffer: Buffer): Promise<boolean> {
	return isBinaryFile(buffer);
}

/**
 * Check if a file should be synced based on path, size, and content.
 * Returns true if the file should be synced.
 */
export async function shouldSyncFile(
	path: string,
	buffer: Buffer
): Promise<boolean> {
	// Skip files in ignored directories
	if (shouldSkipDirectory(path)) {
		return false;
	}

	// Skip files over size limit
	if (buffer.length > MAX_FILE_SIZE_BYTES) {
		return false;
	}

	// Skip binary files
	if (await isBinaryFile(buffer)) {
		return false;
	}

	return true;
}

/**
 * Check if a file is editable in the documentation editor.
 * Only markdown files are editable; other text files are read-only for AI reference.
 */
export function isEditableFile(path: string): boolean {
	const filename = path.split('/').pop() || '';
	const lastDot = filename.lastIndexOf('.');
	if (lastDot <= 0) return false;
	const ext = filename.substring(lastDot + 1).toLowerCase();
	return ext === 'md' || ext === 'mdx';
}

/**
 * Strip the root folder from a GitHub ZIP path.
 * GitHub ZIPs contain a root folder like: my-repo-abc123/docs/file.md
 * We want: docs/file.md
 */
export function stripRootFolder(zipPath: string): string {
	const firstSlash = zipPath.indexOf('/');
	if (firstSlash === -1) {
		// No slash means it's the root folder itself, skip it
		return '';
	}
	return zipPath.substring(firstSlash + 1);
}
