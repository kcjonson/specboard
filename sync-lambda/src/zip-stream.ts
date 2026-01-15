/**
 * Streaming ZIP extraction utilities.
 * Downloads GitHub ZIP archives and streams extraction directly to storage service.
 * Memory-efficient: never loads the entire ZIP into memory.
 */

import { Readable } from 'stream';
import unzipper from 'unzipper';
import { shouldSkipDirectory, shouldSyncFile, stripRootFolder, MAX_FILE_SIZE_BYTES } from './file-filter.ts';

const GITHUB_API_URL = 'https://api.github.com';

export interface StreamResult {
	synced: number;
	skipped: number;
	errors: string[];
	commitSha: string | null;
}

export interface StorageClient {
	putFile(projectId: string, path: string, content: string): Promise<void>;
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
	storageClient: StorageClient
): Promise<StreamResult> {
	const result: StreamResult = {
		synced: 0,
		skipped: 0,
		errors: [],
		commitSha: null,
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

	// Extract commit SHA from the redirect URL or Content-Disposition header
	// GitHub includes the SHA in the archive filename: repo-{sha}.zip
	const contentDisposition = response.headers.get('content-disposition');
	if (contentDisposition) {
		const match = contentDisposition.match(/filename=.*?-([a-f0-9]+)\.zip/i);
		if (match && match[1]) {
			result.commitSha = match[1];
		}
	}

	// Convert web ReadableStream to Node.js Readable
	const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

	// Process the ZIP stream
	await new Promise<void>((resolve, reject) => {
		// Handle errors on the source stream
		nodeStream.on('error', reject);

		nodeStream
			.pipe(unzipper.Parse())
			.on('entry', async (entry: unzipper.Entry) => {
				const zipPath = entry.path;
				const entryType = entry.type; // 'Directory' or 'File'
				// Use compressed size as estimate; actual size checked after reading
				const estimatedSize = entry.vars?.compressedSize ?? 0;

				// Skip directories
				if (entryType === 'Directory') {
					entry.autodrain();
					return;
				}

				// Strip the root folder from the path
				const path = stripRootFolder(zipPath);

				// Skip empty paths (the root folder itself)
				if (!path) {
					entry.autodrain();
					return;
				}

				// Skip files in ignored directories (early check before reading)
				if (shouldSkipDirectory(path)) {
					result.skipped++;
					entry.autodrain();
					return;
				}

				// Skip files that look too large based on compressed size estimate
				if (estimatedSize > MAX_FILE_SIZE_BYTES / 2) {
					result.skipped++;
					entry.autodrain();
					return;
				}

				try {
					// Read the file content
					const chunks: Buffer[] = [];
					for await (const chunk of entry) {
						chunks.push(chunk as Buffer);
					}
					const buffer = Buffer.concat(chunks);

					// Check if file should be synced (size + binary detection)
					if (!(await shouldSyncFile(path, buffer))) {
						result.skipped++;
						return;
					}

					const content = buffer.toString('utf-8');

					// Upload to storage service
					await storageClient.putFile(projectId, path, content);
					result.synced++;
				} catch (err) {
					result.errors.push(
						`Failed to sync ${path}: ${err instanceof Error ? err.message : String(err)}`
					);
					result.skipped++;
				}
			})
			.on('error', reject)
			.on('close', resolve);
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
