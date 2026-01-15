/**
 * Incremental sync: Use GitHub Compare API to fetch only changed files.
 * Much faster than full sync when only a few files have changed.
 */

import { shouldSkipDirectory, shouldSyncFile } from './file-filter.ts';
import { updateSyncStatus } from './shared/db-utils.ts';
import { createStorageClient } from './shared/storage-client.ts';

const GITHUB_API_URL = 'https://api.github.com';

// Batch size for parallel blob fetches
const BATCH_SIZE = 10;

// Delay between batches to avoid rate limiting (ms)
const BATCH_DELAY_MS = 100;

export interface IncrementalSyncParams {
	projectId: string;
	owner: string;
	repo: string;
	branch: string;
	token: string;
	lastCommitSha: string;
}

export interface IncrementalSyncResult {
	success: boolean;
	synced: number;
	removed: number;
	commitSha: string | null;
	error?: string;
}

interface GitHubCompareFile {
	sha: string;
	filename: string;
	status: 'added' | 'modified' | 'removed' | 'renamed';
	previous_filename?: string;
}

interface GitHubCompareResponse {
	status: string;
	ahead_by: number;
	behind_by: number;
	total_commits: number;
	commits: Array<{ sha: string }>;
	files?: GitHubCompareFile[];
}

interface GitHubBlob {
	content: string;
	encoding: 'base64' | 'utf-8';
	sha: string;
	size: number;
}

/**
 * Compare two commits and get the list of changed files.
 */
async function getChangedFiles(
	owner: string,
	repo: string,
	base: string,
	head: string,
	token: string
): Promise<{ files: GitHubCompareFile[]; headSha: string }> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${base}...${head}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
	);

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error('Repository or commits not found');
		}
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
			throw new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
		}
		throw new Error(`GitHub Compare API error: ${response.status}`);
	}

	const data: GitHubCompareResponse = await response.json();

	// Get the latest commit SHA
	const headSha =
		data.commits.length > 0
			? (data.commits[data.commits.length - 1]?.sha ?? base)
			: base;

	return {
		files: data.files || [],
		headSha,
	};
}

/**
 * Fetch a blob's content from GitHub as a Buffer.
 */
async function fetchBlobBuffer(
	owner: string,
	repo: string,
	sha: string,
	token: string
): Promise<Buffer> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${sha}`,
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
		throw new Error(`Failed to fetch blob ${sha}: ${response.status}`);
	}

	const blob: GitHubBlob = await response.json();

	// Decode content to Buffer
	if (blob.encoding === 'base64') {
		return Buffer.from(blob.content, 'base64');
	}

	return Buffer.from(blob.content, 'utf-8');
}

/**
 * Process files in batches to avoid rate limiting.
 */
async function processBatches<T, R>(
	items: T[],
	batchSize: number,
	delayMs: number,
	processor: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchResults = await Promise.all(batch.map(processor));
		results.push(...batchResults);

		// Delay between batches (except for the last batch)
		if (i + batchSize < items.length) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	return results;
}

/**
 * Perform incremental sync: fetch only changed files since last sync.
 */
export async function performIncrementalSync(
	params: IncrementalSyncParams,
	storageServiceUrl: string,
	storageApiKey: string
): Promise<IncrementalSyncResult> {
	const { projectId, owner, repo, branch, token, lastCommitSha } = params;

	try {
		// Mark sync as in progress
		await updateSyncStatus(projectId, 'syncing');

		// Get changed files since last sync
		const { files, headSha } = await getChangedFiles(
			owner,
			repo,
			lastCommitSha,
			branch,
			token
		);

		// If no changes, we're done
		if (files.length === 0) {
			await updateSyncStatus(projectId, 'completed', headSha);
			return {
				success: true,
				synced: 0,
				removed: 0,
				commitSha: headSha,
			};
		}

		// Create storage client
		const storageClient = createStorageClient(storageServiceUrl, storageApiKey);

		// Pre-filter files by directory (early skip, no content fetch needed)
		const notInSkipDir = (f: GitHubCompareFile): boolean => !shouldSkipDirectory(f.filename);

		// Separate files by action
		const toSync = files.filter(
			(f) =>
				(f.status === 'added' || f.status === 'modified') &&
				notInSkipDir(f)
		);

		const toRemove = files.filter(
			(f) => f.status === 'removed' && notInSkipDir(f)
		);

		// Handle renamed files: remove old, add new
		const renamed = files.filter(
			(f) => f.status === 'renamed' && notInSkipDir(f)
		);
		for (const file of renamed) {
			if (file.previous_filename && !shouldSkipDirectory(file.previous_filename)) {
				toRemove.push({
					...file,
					filename: file.previous_filename,
					status: 'removed',
				});
			}
			toSync.push({ ...file, status: 'added' });
		}

		let synced = 0;
		let removed = 0;

		// Sync added/modified files in batches
		// Fetch content, check size + binary, then upload if valid
		await processBatches(toSync, BATCH_SIZE, BATCH_DELAY_MS, async (file) => {
			try {
				const buffer = await fetchBlobBuffer(owner, repo, file.sha, token);

				// Check if file should be synced (size + binary detection)
				if (!(await shouldSyncFile(file.filename, buffer))) {
					return;
				}

				const content = buffer.toString('utf-8');
				await storageClient.putFile(projectId, file.filename, content);
				synced++;
			} catch (err) {
				console.error(`Failed to sync ${file.filename}:`, err);
			}
		});

		// Remove deleted files
		await processBatches(toRemove, BATCH_SIZE, BATCH_DELAY_MS, async (file) => {
			try {
				await storageClient.deleteFile(projectId, file.filename);
				removed++;
			} catch (err) {
				console.error(`Failed to remove ${file.filename}:`, err);
			}
		});

		// Mark sync as completed
		await updateSyncStatus(projectId, 'completed', headSha);

		return {
			success: true,
			synced,
			removed,
			commitSha: headSha,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);

		// Mark sync as failed
		await updateSyncStatus(projectId, 'failed', null, errorMessage);

		return {
			success: false,
			synced: 0,
			removed: 0,
			commitSha: null,
			error: errorMessage,
		};
	}
}
