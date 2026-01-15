/**
 * Utility functions for storage handlers.
 */

import path from 'path';

/**
 * Virtual base directory for path resolution.
 * This is used to ensure resolved paths stay within bounds.
 */
const VIRTUAL_BASE = '/storage';

/**
 * Validate and normalize a file path.
 * Prevents path traversal attacks using path.resolve with a base directory.
 * More robust than pattern matching as it uses the OS's native path resolution.
 *
 * @param filePath - The path to validate
 * @returns Normalized path, or null if invalid
 */
export function validatePath(filePath: string): string | null {
	if (!filePath || typeof filePath !== 'string') {
		return null;
	}

	// Check for null bytes (security - must check before path operations)
	if (filePath.includes('\0')) {
		return null;
	}

	// Reject absolute paths
	if (filePath.startsWith('/')) {
		return null;
	}

	// Resolve the path against our virtual base directory
	// This handles all traversal attempts: .., ./../../, foo/../../../etc
	const resolved = path.resolve(VIRTUAL_BASE, filePath);

	// Verify the resolved path stays within the virtual base
	if (!resolved.startsWith(VIRTUAL_BASE + '/')) {
		return null;
	}

	// Extract the relative path (remove the virtual base prefix)
	const relativePath = resolved.slice(VIRTUAL_BASE.length + 1);

	// Check for empty path
	if (!relativePath) {
		return null;
	}

	return relativePath;
}
