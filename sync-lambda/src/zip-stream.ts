/**
 * Streaming ZIP extraction utilities.
 * Downloads GitHub ZIP archives and streams extraction directly to storage service.
 * Memory-efficient: never loads the entire ZIP into memory.
 */

import { Readable } from 'stream';
import unzipper from 'unzipper';
import { isInSkippedDirectory } from '@specboard/core/sync-paths';
import { isBinaryContent, stripRootFolder, MAX_FILE_SIZE_BYTES } from './file-filter.ts';
import type { StorageClient } from './shared/storage-client.ts';
import type { TreeEntry } from './tree.ts';

/**
 * Entries handled at once. The parser only moves on once an entry is read, so waiting
 * for a slot before reading one holds the archive back too, which keeps uploads from
 * bursting past the storage service's rate limit and bounds memory.
 */
const UPLOAD_CONCURRENCY = 10;

/** Run tasks with at most `limit` running; the rest wait their turn, in order. */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			active--;
			waiting.shift()?.();
		}
	};
}

const GITHUB_API_URL = 'https://api.github.com';

export interface StreamResult {
	synced: number;
	skipped: number;
	errors: string[];
	/**
	 * The paths storage holds for the archive now: every file uploaded, and every one
	 * recorded as one the editor can't hold (binary, too large). Pruning removes the
	 * rest; a file in a skipped directory isn't stored at all. Only complete when
	 * `errors` is empty.
	 */
	kept: Set<string>;
}


/**
 * Download and stream a GitHub repository ZIP to storage.
 * Uses streaming to keep memory usage constant regardless of ZIP size.
 */
export async function streamGitHubZipToStorage(
	owner: string,
	repo: string,
	ref: string,
	token: string,
	projectId: string,
	storageClient: Pick<StorageClient, 'putFile' | 'markUnavailable'>,
	tree: Map<string, TreeEntry>
): Promise<StreamResult> {
	const result: StreamResult = {
		synced: 0,
		skipped: 0,
		errors: [],
		kept: new Set(),
	};

	// Get ZIP URL (GitHub returns 302 redirect to S3-hosted archive)
	const zipUrl = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`;

	const response = await fetch(zipUrl, {
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
		},
		redirect: 'follow',
	});

	if (!response.ok) {
		// Check for rate limiting
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
			throw new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
		}
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	if (!response.body) {
		throw new Error('No response body from GitHub');
	}

	// Convert web ReadableStream to Node.js Readable
	const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

	// Process the ZIP stream. The parser closes once it has read the last entry, which
	// can be before the last uploads finish, so close waits for every entry's handler.
	const inFlight: Array<Promise<void>> = [];
	await new Promise<void>((resolve, reject) => {
		// Handle errors on the source stream
		nodeStream.on('error', reject);

		const handleEntry = async (entry: unzipper.Entry): Promise<void> => {
			// Skip directories
			if (entry.type === 'Directory') {
				entry.autodrain();
				return;
			}

			// Strip the root folder; an empty path is the root folder itself
			const path = stripRootFolder(entry.path);
			if (!path) {
				entry.autodrain();
				return;
			}

			// Files in ignored directories are never stored
			if (isInSkippedDirectory(path)) {
				result.skipped++;
				entry.autodrain();
				return;
			}

			try {
				// The tree is the commit's file list: a file the archive has and it doesn't
				// means the two don't describe the same commit.
				const listed = tree.get(path);
				if (!listed || listed.submodule) {
					entry.autodrain();
					throw new Error('not in the commit\'s tree');
				}

				// Too large to hold: recorded from the tree without reading the bytes.
				if (listed.size > MAX_FILE_SIZE_BYTES) {
					entry.autodrain();
					await storageClient.markUnavailable(projectId, path, 'too_large', listed.sha, listed.size);
					result.skipped++;
					result.kept.add(path);
					return;
				}

				const chunks: Buffer[] = [];
				for await (const chunk of entry) {
					chunks.push(chunk as Buffer);
				}
				const buffer = Buffer.concat(chunks);
				if (await isBinaryContent(buffer)) {
					await storageClient.markUnavailable(projectId, path, 'binary', listed.sha, listed.size);
					result.skipped++;
				} else {
					await storageClient.putFile(projectId, path, buffer.toString('utf-8'));
					result.synced++;
				}
				result.kept.add(path);
			} catch (err) {
				result.errors.push(
					`Failed to sync ${path}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		};
		const limit = createLimiter(UPLOAD_CONCURRENCY);

		nodeStream
			.pipe(unzipper.Parse())
			.on('entry', (entry: unzipper.Entry) => {
				inFlight.push(limit(() => handleEntry(entry)));
			})
			.on('error', reject)
			.on('close', () => {
				Promise.all(inFlight).then(() => resolve(), reject);
			});
	});

	return result;
}

/**
 * Get the current HEAD commit SHA for a branch.
 * Used as fallback if we can't extract SHA from ZIP response.
 */
export async function getHeadCommitSha(
	owner: string,
	repo: string,
	branch: string,
	token: string
): Promise<string> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
	);

	if (!response.ok) {
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
			throw new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
		}
		throw new Error(`Failed to get HEAD commit: ${response.status}`);
	}

	const data = (await response.json()) as { object: { sha: string } };
	return data.object.sha;
}
