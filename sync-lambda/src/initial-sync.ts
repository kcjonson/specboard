/**
 * Initial sync: Download entire repository as ZIP and stream to storage.
 * Used for first-time repository import, and by incremental sync when GitHub's compare
 * can't describe everything that changed.
 */

import { streamGitHubZipToStorage, getHeadCommitSha } from './zip-stream.ts';
import { completeSync, markSyncFailed, markSyncing } from './shared/db-utils.ts';
import { createStorageClient, type StorageClient } from './shared/storage-client.ts';

export interface InitialSyncParams {
	projectId: string;
	owner: string;
	repo: string;
	branch: string;
	token: string;
	/** The pending lock the API took for this sync. */
	lockToken: Date;
}

export interface InitialSyncResult {
	success: boolean;
	synced: number;
	skipped: number;
	pruned: number;
	commitSha: string | null;
	error?: string;
}

/** Thrown when the sync's lock went stale and someone else holds it now. */
export const SUPERSEDED = 'Sync was superseded by another sync or a commit';

/**
 * Make storage's committed files the branch at `head` (a full SHA): stream that
 * commit's archive in, then remove committed files the archive doesn't have (deleted
 * or renamed on GitHub since the last sync).
 */
export async function syncArchive(
	params: Omit<InitialSyncParams, 'lockToken'>,
	storageClient: StorageClient,
	head: string
): Promise<{ synced: number; skipped: number; pruned: number }> {
	const { projectId, owner, repo, token } = params;
	const result = await streamGitHubZipToStorage(owner, repo, head, token, projectId, storageClient);
	// A file that didn't make it in would otherwise be pruned, or left stale, under a
	// sync point that says it's current: fail, and leave it to a retry.
	if (result.errors.length > 0) {
		throw new Error(`Couldn't sync ${result.errors.length} file(s): ${result.errors.slice(0, 3).join('; ')}`);
	}

	const stale = (await storageClient.listFiles(projectId)).filter((path) => !result.kept.has(path));
	for (const path of stale) {
		await storageClient.deleteFile(projectId, path);
	}
	return { synced: result.synced, skipped: result.skipped, pruned: stale.length };
}

/**
 * Perform initial sync: resolve the branch head to a full SHA, sync that commit's
 * archive, and make it the sync point. The archive and the sync point name the same
 * commit, so a push landing mid-sync is picked up by the next pull, not skipped.
 */
export async function performInitialSync(
	params: InitialSyncParams,
	storageServiceUrl: string,
	storageApiKey: string
): Promise<InitialSyncResult> {
	const { projectId, owner, repo, branch, token, lockToken } = params;
	const failed = (error: string): InitialSyncResult => ({ success: false, synced: 0, skipped: 0, pruned: 0, commitSha: null, error });

	const lock = await markSyncing(projectId, lockToken);
	if (!lock) return failed(SUPERSEDED);

	try {
		const head = await getHeadCommitSha(owner, repo, branch, token);
		const result = await syncArchive(params, createStorageClient(storageServiceUrl, storageApiKey), head);

		// A full sync can't tell a rename from a delete and an add, so it leaves spec links.
		if (!(await completeSync(projectId, lock, undefined, head, { renamed: [], deleted: [] }))) {
			return failed(SUPERSEDED);
		}
		return { success: true, ...result, commitSha: head };
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await markSyncFailed(projectId, lock, errorMessage);
		return failed(errorMessage);
	}
}
