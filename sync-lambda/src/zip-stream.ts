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
import { fetchTreeEntry, gitBlobSha, GitBlobHash } from './tree.ts';
import type { TimeBudget } from './time-budget.ts';

/** Entries handled at once, which keeps uploads from bursting past the storage service's rate limit. */
const UPLOAD_CONCURRENCY = 10;

/**
 * Entries read from the archive but not yet finished (running or waiting for a slot).
 * unzipper's parser doesn't wait for an entry to be read before parsing the next, so
 * left alone it queues the whole archive in memory at once. The archive is fed to it
 * only while this many or fewer are outstanding, which holds memory to a few entries
 * and lets the time budget, checked as each entry starts, see the real pace.
 */
const MAX_OUTSTANDING_ENTRIES = UPLOAD_CONCURRENCY * 2;

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
	budget: TimeBudget
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
	const parser = unzipper.Parse();
	const limit = createLimiter(UPLOAD_CONCURRENCY);

	const inFlight: Array<Promise<void>> = [];
	const unfinished = new Set<unzipper.Entry>();
	let outstanding = 0;
	let aborted = false;
	let abortReason: unknown = null;
	let parserClosed = false;
	let drained = true;
	const waiters: Array<() => void> = [];
	const nudge = (): void => {
		for (const wake of waiters.splice(0)) wake();
	};
	const until = async (done: () => boolean): Promise<void> => {
		while (!done()) await new Promise<void>((resolve) => waiters.push(resolve));
	};

	/** Out of time, or the archive broke: stop reading, and end every read still waiting on more of it. */
	const abort = (reason: unknown): void => {
		if (aborted) return;
		aborted = true;
		abortReason = reason;
		nodeStream.destroy();
		for (const entry of unfinished) entry.destroy(new Error('sync stopped'));
		nudge();
	};

	parser.on('drain', () => {
		drained = true;
		nudge();
	});
	parser.on('close', () => {
		parserClosed = true;
		nudge();
	});
	parser.on('error', abort);
	nodeStream.on('error', abort);

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

		// Checked as each entry starts work, so it measures the uploads, not the parsing.
		try {
			budget.check();
		} catch (err) {
			entry.autodrain();
			abort(err);
			return;
		}

		try {
			// The archive's local header gives the size, unless the entry defers it to a
			// data descriptor after the bytes (flag bit 3). unzipper parses the field (and
			// its zip64 form) but its published types leave it off.
			const vars = entry.vars as typeof entry.vars & { uncompressedSize: number };
			const declared = (vars.flags & 0x08) === 0 ? vars.uncompressedSize : null;

			// Too large to hold, by its header: hashed as git does, never buffered.
			if (declared !== null && declared > MAX_FILE_SIZE_BYTES) {
				const hash = new GitBlobHash(declared);
				let seen = 0;
				for await (const chunk of entry) {
					hash.update(chunk as Buffer);
					seen += (chunk as Buffer).length;
				}
				if (seen !== declared) throw new Error(`archive entry is ${seen} bytes, header said ${declared}`);
				await storageClient.markUnavailable(projectId, path, 'too_large', hash.digest(), declared);
				result.skipped++;
				result.kept.add(path);
				return;
			}

			// Otherwise read it, never keeping more than the limit whatever the header said.
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of entry) {
				size += (chunk as Buffer).length;
				if (size <= MAX_FILE_SIZE_BYTES) chunks.push(chunk as Buffer);
			}
			if (size > MAX_FILE_SIZE_BYTES) {
				// Over the limit with no size up front, so its git hash couldn't be taken
				// while reading: ask GitHub for this one file's.
				const listed = await fetchTreeEntry(owner, repo, ref, path, token);
				if (listed?.kind !== 'file') throw new Error('not a file in the commit');
				await storageClient.markUnavailable(projectId, path, 'too_large', listed.sha, listed.size);
				result.skipped++;
				result.kept.add(path);
				return;
			}

			if (aborted) return;
			const buffer = Buffer.concat(chunks);
			if (await isBinaryContent(buffer)) {
				await storageClient.markUnavailable(projectId, path, 'binary', gitBlobSha(buffer), buffer.length);
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

	parser.on('entry', (entry: unzipper.Entry) => {
		outstanding++;
		unfinished.add(entry);
		// An entry stopped by abort() errors; nothing is waiting on it by then.
		entry.on('error', () => {});
		inFlight.push(
			limit(async () => {
				try {
					if (aborted) {
						if (!entry.destroyed) entry.autodrain();
						return;
					}
					await handleEntry(entry);
				} finally {
					unfinished.delete(entry);
					outstanding--;
					nudge();
				}
			})
		);
	});

	// Feed the archive to the parser a chunk at a time, only while few entries are
	// outstanding. The parser closes once it has read the last entry, which can be before
	// the last uploads finish, so the sync waits for every entry's handler as well.
	try {
		for await (const chunk of nodeStream) {
			await until(() => aborted || outstanding <= MAX_OUTSTANDING_ENTRIES);
			if (aborted) break;
			drained = parser.write(chunk);
			await until(() => aborted || drained);
			if (aborted) break;
		}
		if (!aborted) {
			parser.end();
			await until(() => aborted || parserClosed);
		}
	} catch (err) {
		abort(err);
	}
	await Promise.allSettled(inFlight);
	if (aborted) throw abortReason;

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
