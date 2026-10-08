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

/** Why a file on the branch isn't stored as content, or null when it is. */
export type UnsyncableReason = 'directory' | 'too_large' | 'binary';

/**
 * Whether a file is stored, and if not, why: it's in a skipped directory (never stored
 * at all), or it's over the size limit or binary (stored as a row with no content, so
 * nothing reads or commits over an older copy).
 */
export async function unsyncableReason(path: string, buffer: Buffer): Promise<UnsyncableReason | null> {
	if (shouldSkipDirectory(path)) return 'directory';
	if (buffer.length > MAX_FILE_SIZE_BYTES) return 'too_large';
	if (await isBinaryFile(buffer)) return 'binary';
	return null;
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
