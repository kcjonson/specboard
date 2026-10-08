/**
 * Incremental sync: Use GitHub Compare API to fetch only changed files.
 * Much faster than full sync when only a few files have changed.
 */

import type { SpecPathChanges } from '@specboard/db';
import { shouldSkipDirectory, shouldSyncFile } from './file-filter.ts';
import { completeSync, markSyncFailed, markSyncing } from './shared/db-utils.ts';
import { SUPERSEDED, syncArchive } from './initial-sync.ts';
import { getHeadCommitSha } from './zip-stream.ts';
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
	/** The pending lock the API took for this sync. */
	lockToken: Date;
}

export interface IncrementalSyncResult {
	success: boolean;
	synced: number;
	removed: number;
	commitSha: string | null;
	error?: string;
}

export interface GitHubCompareFile {
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

/** GitHub's compare lists at most this many files, and its `commits` at most 250. */
const COMPARE_FILE_LIMIT = 300;

/**
 * Compare two commits and get the list of changed files, and whether that list is
 * complete: past GitHub's limits the compare silently leaves files out.
 */
async function getChangedFiles(
	owner: string,
	repo: string,
	base: string,
	head: string,
	token: string
): Promise<{ files: GitHubCompareFile[]; complete: boolean }> {
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
	const files = data.files || [];
	// 'diverged' or 'behind' means the branch was rewritten (a force-push): the compare
	// then diffs from the merge base, not from the last sync, so its files aren't the
	// whole story either.
	const linear = data.status === 'ahead' || data.status === 'identical';
	return {
		files,
		complete: linear && files.length < COMPARE_FILE_LIMIT && data.total_commits <= data.commits.length,
	};
}

/**
 * What the compared commits did to the files spec links point at. Every removal and
 * rename counts, including ones the file sync skips: a link names a path, not a file
 * the editor shows. GitHub paths have no leading slash; spec paths do.
 */
export function comparedSpecPathChanges(files: GitHubCompareFile[]): SpecPathChanges {
	return {
		renamed: files.flatMap((f) =>
			f.status === 'renamed' && f.previous_filename
				? [{ from: `/${f.previous_filename}`, to: `/${f.filename}` }]
				: []
		),
		deleted: files.filter((f) => f.status === 'removed').map((f) => `/${f.filename}`),
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
 * Perform incremental sync: fetch only what changed between the last sync and the
 * branch head, resolved to a full SHA first so the files and the new sync point name
 * the same commit. When GitHub's compare can't list everything, fall back to a full
 * sync of that commit.
 */
export async function performIncrementalSync(
	params: IncrementalSyncParams,
	storageServiceUrl: string,
	storageApiKey: string
): Promise<IncrementalSyncResult> {
	const { projectId, owner, repo, branch, token, lastCommitSha, lockToken } = params;
	const failed = (error: string): IncrementalSyncResult => ({ success: false, synced: 0, removed: 0, commitSha: null, error });

	const lock = await markSyncing(projectId, lockToken);
	if (!lock) return failed(SUPERSEDED);

	try {
		const headSha = await getHeadCommitSha(owner, repo, branch, token);
		const { files, complete } = await getChangedFiles(owner, repo, lastCommitSha, headSha, token);
		const storageClient = createStorageClient(storageServiceUrl, storageApiKey);

		let synced = 0;
		let removed = 0;
		let linkChanges: SpecPathChanges;
		if (complete) {
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

			// Commits pulled in here move spec links the way a commit made in the editor
			// does, together with the sync point below.
			linkChanges = comparedSpecPathChanges(files);
		} else {
			const result = await syncArchive({ projectId, owner, repo, branch, token }, storageClient, headSha);
			synced = result.synced;
			removed = result.pruned;
			// A full sync can't tell a rename from a delete and an add, so it leaves spec links.
			linkChanges = { renamed: [], deleted: [] };
		}

		// With no new commits this still stores the head's full SHA, which heals a short
		// one an older full sync left behind.
		if (!(await completeSync(projectId, lock, lastCommitSha, headSha, linkChanges))) {
			return failed(SUPERSEDED);
		}
		return { success: true, synced, removed, commitSha: headSha };
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await markSyncFailed(projectId, lock, errorMessage);
		return failed(errorMessage);
	}
}
