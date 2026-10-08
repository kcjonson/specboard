/**
 * Streaming ZIP extraction utilities.
 * Downloads GitHub ZIP archives and streams extraction directly to storage service.
 * Memory-efficient: never loads the entire ZIP into memory.
 */

import { createHash } from 'crypto';
import { Readable } from 'stream';
import unzipper from 'unzipper';
import { shouldSkipDirectory, unsyncableReason, stripRootFolder, MAX_FILE_SIZE_BYTES } from './file-filter.ts';
import type { StorageClient } from './shared/storage-client.ts';

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
	storageClient: Pick<StorageClient, 'putFile' | 'markUnavailable'>
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
			if (shouldSkipDirectory(path)) {
				result.skipped++;
				entry.autodrain();
				return;
			}

			try {
				// Hash every byte, but only keep the bytes of a file small enough to store,
				// so a huge file costs its hash and nothing more.
				const hash = createHash('sha1');
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of entry) {
					const bytes = chunk as Buffer;
					hash.update(bytes);
					size += bytes.length;
					if (size <= MAX_FILE_SIZE_BYTES) chunks.push(bytes);
				}
				const contentHash = hash.digest('hex');

				const reason = size > MAX_FILE_SIZE_BYTES ? 'too_large' : await unsyncableReason(path, Buffer.concat(chunks));
				if (reason === 'too_large' || reason === 'binary') {
					await storageClient.markUnavailable(projectId, path, reason, contentHash, size);
					result.skipped++;
				} else {
					await storageClient.putFile(projectId, path, Buffer.concat(chunks).toString('utf-8'));
					result.synced++;
				}
				result.kept.add(path);
			} catch (err) {
				result.errors.push(
					`Failed to sync ${path}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		};

		nodeStream
			.pipe(unzipper.Parse())
			.on('entry', (entry: unzipper.Entry) => {
				inFlight.push(handleEntry(entry));
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
