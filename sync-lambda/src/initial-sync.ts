/**
 * Initial sync: Download entire repository as ZIP and stream to storage.
 * Used for first-time repository import.
 */

import { query } from '@doc-platform/db';
import {
	streamGitHubZipToStorage,
	getHeadCommitSha,
	type StorageClient,
} from './zip-stream.ts';

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
 * Update project sync status in the database.
 */
async function updateSyncStatus(
	projectId: string,
	status: 'pending' | 'syncing' | 'completed' | 'failed',
	commitSha?: string | null,
	error?: string | null
): Promise<void> {
	const now = new Date().toISOString();

	if (status === 'syncing') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_started_at = $2, sync_error = NULL
			 WHERE id = $3`,
			[status, now, projectId]
		);
	} else if (status === 'completed') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_completed_at = $2, last_synced_commit_sha = $3, sync_error = NULL
			 WHERE id = $4`,
			[status, now, commitSha, projectId]
		);
	} else if (status === 'failed') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_completed_at = $2, sync_error = $3
			 WHERE id = $4`,
			[status, now, error, projectId]
		);
	}
}

/**
 * Create a storage client that calls the storage service HTTP API.
 */
function createStorageClient(
	storageServiceUrl: string,
	storageApiKey: string
): StorageClient {
	return {
		async putFile(projectId: string, path: string, content: string): Promise<void> {
			const response = await fetch(
				`${storageServiceUrl}/files/${projectId}/${path}`,
				{
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						'X-Internal-API-Key': storageApiKey,
					},
					body: JSON.stringify({ content }),
				}
			);

			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				const message = (error as { error?: string })?.error || response.statusText;
				throw new Error(message || 'Storage service request failed');
			}
		},
	};
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
