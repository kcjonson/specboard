/**
 * Initial sync: Download entire repository as ZIP and stream to storage.
 * Used for first-time repository import.
 */

import {
	streamGitHubZipToStorage,
	getHeadCommitSha,
} from './zip-stream.ts';
import { updateSyncStatus } from './shared/db-utils.ts';
import { createStorageClient } from './shared/storage-client.ts';

export interface InitialSyncParams {
	projectId: string;
	owner: string;
	repo: string;
	branch: string;
	token: string;
}

export interface InitialSyncResult {
	success: boolean;
	synced: number;
	skipped: number;
	commitSha: string | null;
	error?: string;
}

/**
 * Perform initial sync: download entire repo as ZIP and stream to storage.
 */
export async function performInitialSync(
	params: InitialSyncParams,
	storageServiceUrl: string,
	storageApiKey: string
): Promise<InitialSyncResult> {
	const { projectId, owner, repo, branch, token } = params;

	try {
		// Mark sync as in progress
		await updateSyncStatus(projectId, 'syncing');

		// Create storage client
		const storageClient = createStorageClient(storageServiceUrl, storageApiKey);

		// Stream ZIP to storage
		const result = await streamGitHubZipToStorage(
			owner,
			repo,
			branch,
			token,
			projectId,
			storageClient
		);

		// If we couldn't get commit SHA from ZIP response, fetch it directly
		let commitSha = result.commitSha;
		if (!commitSha) {
			commitSha = await getHeadCommitSha(owner, repo, branch, token);
		}

		// Mark sync as completed
		await updateSyncStatus(projectId, 'completed', commitSha);

		return {
			success: true,
			synced: result.synced,
			skipped: result.skipped,
			commitSha,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);

		// Mark sync as failed
		await updateSyncStatus(projectId, 'failed', null, errorMessage);

		return {
			success: false,
			synced: 0,
			skipped: 0,
			commitSha: null,
			error: errorMessage,
		};
	}
}
