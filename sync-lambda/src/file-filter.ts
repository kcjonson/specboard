/**
 * What a sync stores. Files in skipped directories are never stored
 * (`@specboard/core/sync-paths`, shared with the API). Text files up to the size limit
 * are stored with their content; a binary file, or one over the limit, is stored as a
 * row with no content, so nobody reads or commits over an older copy.
 */

import { isBinaryFile } from 'isbinaryfile';

/** Largest file a sync stores with its content (500 KB). */
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

/** Whether bytes a sync downloaded (already under the size limit) are binary. */
export async function isBinaryContent(buffer: Buffer): Promise<boolean> {
	return isBinaryFile(buffer);
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
