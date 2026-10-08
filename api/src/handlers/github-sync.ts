/**
 * GitHub sync handlers for cloud storage mode.
 * Invokes Lambda for initial/incremental sync operations.
 *
 * In local development, calls the Lambda handler directly.
 * In production, invokes AWS Lambda asynchronously.
 */

import type { Context } from 'hono';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { decrypt, type EncryptedData } from '@specboard/auth';
import { query, recordCommit } from '@specboard/db';
import { apiUserId, requireResolvedProject } from '../project-access.ts';
import { log } from '@specboard/core';
import { getStorageClient } from '../services/storage/storage-client.ts';
import { getGitHubConnection } from '../services/github-token.ts';
import {
	createGitHubCommit,
	generateCommitMessage,
	committedSpecPathChanges,
	type PendingChange,
} from '../services/github-commit.ts';
import type { SyncEvent } from '@specboard/sync-lambda';

// Lambda client for invoking sync function (production only)
const lambdaClient = new LambdaClient({
	region: process.env.AWS_REGION || 'us-west-2',
});

const GITHUB_SYNC_LAMBDA_NAME =
	process.env.GITHUB_SYNC_LAMBDA_NAME || 'specboard-github-sync';

/**
 * Invoke the sync Lambda function.
 * In development, calls the handler directly (in-process).
 * In production, invokes AWS Lambda asynchronously.
 */
async function invokeSyncLambda(payload: SyncEvent): Promise<void> {
	if (process.env.NODE_ENV === 'development') {
		// Local dev: import and call handler directly
		// Dynamic import to avoid loading Lambda deps in production
		// Wrap in try-catch to handle sync errors during import
		try {
			const { handler } = await import('@specboard/sync-lambda');

			// Run async (don't await) to mimic Lambda async invocation
			Promise.resolve()
				.then(() => handler(payload))
				.then((result) => {
					log({
						type: 'github',
						level: result.success ? 'info' : 'warn',
						event: 'local_sync_completed',
						projectId: payload.projectId,
						success: result.success,
						synced: result.synced,
						error: result.error,
					});
				})
				.catch((err) => {
					log({
						type: 'github',
						level: 'error',
						event: 'local_sync_error',
						projectId: payload.projectId,
						error: err instanceof Error ? err.message : String(err),
					});
				});

			log({
				type: 'github',
				level: 'info',
				event: 'local_sync_started',
				projectId: payload.projectId,
				mode: payload.mode,
			});
		} catch (err) {
			log({
				type: 'github',
				level: 'error',
				event: 'local_sync_import_error',
				projectId: payload.projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	// Production: invoke AWS Lambda
	await lambdaClient.send(
		new InvokeCommand({
			FunctionName: GITHUB_SYNC_LAMBDA_NAME,
			InvocationType: 'Event', // Async invocation
			Payload: Buffer.from(JSON.stringify(payload)),
		})
	);
}

/**
 * Repository config from JSONB column.
 */
interface RepositoryConfig {
	remote?: {
		provider: string;
		owner: string;
		repo: string;
		url: string;
	};
	branch?: string;
}

/**
 * Project with repository and sync info.
 */
interface ProjectWithRepo {
	id: string;
	owner: string;
	repo: string;
	branch: string;
	lastSyncedCommitSha: string | null;
	syncStatus: string | null;
	syncStartedAt: string | null;
	syncCompletedAt: string | null;
	syncError: string | null;
}

/**
 * Get project with repository info from JSONB column.
 */
export async function getProjectWithRepo(projectId: string): Promise<ProjectWithRepo | null> {
	const result = await query<{
		id: string;
		repository: RepositoryConfig;
		last_synced_commit_sha: string | null;
		sync_status: string | null;
		sync_started_at: string | null;
		sync_completed_at: string | null;
		sync_error: string | null;
	}>(
		`SELECT id, repository, last_synced_commit_sha, sync_status,
		        sync_started_at, sync_completed_at, sync_error
		 FROM projects
		 WHERE id = $1 AND storage_mode = 'cloud'`,
		[projectId]
	);

	const row = result.rows[0];
	if (!row) {
		return null;
	}

	// Parse repository JSONB with null check
	const repo = row.repository;
	if (!repo || !repo.remote || repo.remote.provider !== 'github') {
		return null;
	}

	return {
		id: row.id,
		owner: repo.remote.owner,
		repo: repo.remote.repo,
		branch: repo.branch || 'main',
		lastSyncedCommitSha: row.last_synced_commit_sha,
		syncStatus: row.sync_status,
		syncStartedAt: row.sync_started_at,
		syncCompletedAt: row.sync_completed_at,
		syncError: row.sync_error,
	};
}

/**
 * Atomically set sync status to pending if not already syncing.
 * Returns true if status was updated, false if sync already in progress.
 */
export async function trySetSyncPending(projectId: string): Promise<boolean> {
	const result = await query(
		`UPDATE projects
		 SET sync_status = 'pending', sync_error = NULL
		 WHERE id = $1 AND (sync_status IS NULL OR sync_status NOT IN ('pending', 'syncing'))
		 RETURNING id`,
		[projectId]
	);
	return result.rows.length > 0;
}

/**
 * Record that a sync could not be started, so the project shows "Sync failed" with a
 * Retry instead of sitting in cloud mode with no status. Only applies when nothing is
 * tracking the sync (status NULL): a pending or running sync keeps its own status.
 */
export async function markSyncStartFailed(projectId: string, message: string): Promise<void> {
	await query(
		`UPDATE projects
		 SET sync_status = 'failed', sync_error = $2, sync_completed_at = NOW()
		 WHERE id = $1 AND sync_status IS NULL`,
		[projectId, message]
	);
}

/**
 * Start initial sync programmatically (non-HTTP, for use from other handlers).
 * Fire-and-forget - invokes Lambda asynchronously.
 */
export async function startGitHubInitialSync(
	projectId: string,
	userId: string
): Promise<void> {
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		throw new Error('Project not found or not in cloud mode');
	}

	const encryptedToken = (await getGitHubConnection(userId))?.encryptedToken;
	if (!encryptedToken) {
		throw new Error('GitHub not connected');
	}

	const acquired = await trySetSyncPending(projectId);
	if (!acquired) {
		throw new Error('Sync already in progress');
	}

	try {
		const payload: SyncEvent = {
			projectId,
			userId,
			owner: project.owner,
			repo: project.repo,
			branch: project.branch,
			encryptedToken,
			mode: 'initial',
		};

		await invokeSyncLambda(payload);

		log({
			type: 'github',
			level: 'info',
			event: 'github_initial_sync_started',
			projectId,
			owner: project.owner,
			repo: project.repo,
		});
	} catch (err) {
		// Reset sync status on failure to invoke
		await query(`UPDATE projects SET sync_status = NULL WHERE id = $1`, [projectId]);
		throw err;
	}
}

/**
 * Start initial sync - downloads entire repository.
 * POST /api/projects/:owner/:project/sync/initial
 */
export async function handleGitHubInitialSync(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const projectId = requireResolvedProject(context).id;

	// Get project with repository info
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	// Get encrypted GitHub token
	const encryptedToken = (await getGitHubConnection(userId))?.encryptedToken;
	if (!encryptedToken) {
		return context.json({ error: 'GitHub not connected' }, 400);
	}

	// Atomically mark sync as pending (prevents race condition)
	const acquired = await trySetSyncPending(projectId);
	if (!acquired) {
		return context.json({ error: 'Sync already in progress' }, 409);
	}

	// Invoke Lambda asynchronously
	try {
		const payload: SyncEvent = {
			projectId,
			userId,
			owner: project.owner,
			repo: project.repo,
			branch: project.branch,
			encryptedToken,
			mode: 'initial',
		};

		await invokeSyncLambda(payload);

		log({
			type: 'github',
			level: 'info',
			event: 'github_initial_sync_started',
			projectId,
			owner: project.owner,
			repo: project.repo,
		});

		return context.json({
			status: 'pending',
			message: 'Initial sync started',
		});
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_sync_lambda_invoke_error',
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});

		// Reset sync status on failure to invoke
		await query(`UPDATE projects SET sync_status = NULL WHERE id = $1`, [projectId]);

		return context.json({ error: 'Failed to start sync' }, 500);
	}
}

/**
 * Start incremental sync - fetches only changed files.
 * POST /api/projects/:owner/:project/sync
 */
export async function handleGitHubSync(context: Context): Promise<Response> {
	// All error responses include `success: false` for PullResponse compatibility
	const userId = apiUserId(context);
	const projectId = requireResolvedProject(context).id;

	// Get project with repository info
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		return context.json({ success: false, error: 'Project not found or not in cloud mode' }, 404);
	}

	// Check if initial sync has been done
	if (!project.lastSyncedCommitSha) {
		return context.json(
			{ success: false, error: 'Initial sync required. Use POST /sync/initial first.' },
			400
		);
	}

	// Get encrypted GitHub token
	const encryptedToken = (await getGitHubConnection(userId))?.encryptedToken;
	if (!encryptedToken) {
		return context.json({ success: false, error: 'GitHub not connected' }, 400);
	}

	// Atomically mark sync as pending (prevents race condition)
	const acquired = await trySetSyncPending(projectId);
	if (!acquired) {
		return context.json({ success: false, error: 'Sync already in progress' }, 409);
	}

	// Invoke Lambda asynchronously
	try {
		const payload: SyncEvent = {
			projectId,
			userId,
			owner: project.owner,
			repo: project.repo,
			branch: project.branch,
			encryptedToken,
			mode: 'incremental',
			lastCommitSha: project.lastSyncedCommitSha,
		};

		await invokeSyncLambda(payload);

		log({
			type: 'github',
			level: 'info',
			event: 'github_incremental_sync_started',
			projectId,
			owner: project.owner,
			repo: project.repo,
			lastCommitSha: project.lastSyncedCommitSha,
		});

		// Return response compatible with PullResponse interface expected by frontend.
		// The sync runs asynchronously via Lambda, so we indicate success that it started.
		// commits: 0 indicates the sync is pending - frontend should poll sync status.
		return context.json({
			success: true,
			commits: 0,
			status: 'pending',
			message: 'Incremental sync started',
		});
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_sync_lambda_invoke_error',
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});

		// Reset sync status on failure to invoke
		await query(`UPDATE projects SET sync_status = NULL WHERE id = $1`, [projectId]);

		// Return response compatible with PullResponse interface expected by frontend
		return context.json({ success: false, error: 'Failed to start sync' }, 500);
	}
}

/**
 * Get sync status for a project.
 * GET /api/projects/:owner/:project/sync/status
 */
export async function handleGitHubSyncStatus(context: Context): Promise<Response> {
	const projectId = requireResolvedProject(context).id;

	// Get project with sync info
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	return context.json({
		status: project.syncStatus,
		lastSyncedCommitSha: project.lastSyncedCommitSha,
		syncStartedAt: project.syncStartedAt,
		syncCompletedAt: project.syncCompletedAt,
		error: project.syncError,
	});
}

/**
 * Commit pending changes to GitHub repository.
 * POST /api/projects/:owner/:project/github/commit
 *
 * 1. Read the caller's pending changes from the storage service
 * 2. Create the commit with GitHub's createCommitOnBranch, expecting the branch to be at
 *    the project's last synced commit: if anything landed since, GitHub refuses, the
 *    answer is 409 (pull first), and nothing here changes
 * 3. Promote the commit into storage: its files become the committed files and the
 *    pending changes it took are cleared, in one storage transaction
 * 4. Move spec links for what it renamed and deleted and set last_synced_commit_sha to
 *    it, in one transaction
 *
 * Steps 3 and 4 run after GitHub has the commit, so a failure there can't undo it. If
 * either fails the sync point stays at the old commit and the answer is success with a
 * warning: the next pull's incremental sync brings the commit in like any other, which
 * rewrites the files and moves the links. A failed step 4 leaves step 3 in place, which
 * that sync rewrites to the same content.
 */
export async function handleGitHubCommit(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const projectId = requireResolvedProject(context).id;

	// Get project with repository info
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	// Drafts are made against the last synced commit; without one there's nothing to
	// check the branch against.
	const expectedHeadOid = project.lastSyncedCommitSha;
	if (!expectedHeadOid) {
		return context.json({
			success: false,
			error: { stage: 'commit', message: 'The repository hasn\'t finished its first sync yet.' },
		}, 409);
	}

	// Get encrypted GitHub token
	const encryptedTokenString = (await getGitHubConnection(userId))?.encryptedToken;
	if (!encryptedTokenString) {
		return context.json({ error: 'GitHub not connected' }, 400);
	}

	// Decrypt the token
	let accessToken: string;
	try {
		const encryptedToken: EncryptedData = JSON.parse(encryptedTokenString);
		accessToken = decrypt(encryptedToken);
	} catch (err) {
		log({
			type: 'auth',
			level: 'error',
			event: 'github_token_decrypt_failed',
			userId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'GitHub connection corrupted. Please reconnect.' }, 500);
	}

	// Get pending changes with content
	const storageClient = getStorageClient();
	let pendingChanges;
	try {
		pendingChanges = await storageClient.listPendingChangesWithContent(
			projectId,
			userId
		);
	} catch (err) {
		log({
			type: 'storage',
			level: 'error',
			event: 'list_pending_changes_failed',
			userId,
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});
		const commitError = {
			stage: 'commit' as const,
			message: 'Failed to load pending changes. Please try again.',
		};
		return context.json({ success: false, error: commitError }, 500);
	}

	if (pendingChanges.length === 0) {
		return context.json({ error: 'No changes to commit' }, 400);
	}

	// Convert to PendingChange format for the commit service
	const changes: PendingChange[] = pendingChanges.map((c) => ({
		path: c.path,
		content: c.content,
		action: c.action,
	}));

	// Get commit message from request body or auto-generate
	let commitMessage: string;
	try {
		const body = await context.req.json() as { message?: string };
		commitMessage = body.message || generateCommitMessage(changes);
	} catch {
		// No body or invalid JSON - auto-generate message
		commitMessage = generateCommitMessage(changes);
	}

	// Create commit on GitHub
	log({
		type: 'github',
		level: 'info',
		event: 'github_commit_started',
		projectId,
		owner: project.owner,
		repo: project.repo,
		branch: project.branch,
		filesCount: changes.length,
	});

	const result = await createGitHubCommit({
		owner: project.owner,
		repo: project.repo,
		branch: project.branch,
		token: accessToken,
		message: commitMessage,
		changes,
		expectedHeadOid,
	});

	if (!result.success) {
		log({
			type: 'github',
			level: 'warn',
			event: 'github_commit_failed',
			projectId,
			error: result.error,
			conflictDetected: result.conflictDetected,
		});

		// Format error to match frontend CommitError interface
		const commitError = {
			stage: 'commit' as const,
			message: result.error || 'Commit failed',
		};

		if (result.conflictDetected) {
			return context.json(
				{
					success: false,
					error: commitError,
					conflictDetected: true,
				},
				409
			);
		}

		return context.json(
			{
				success: false,
				error: commitError,
			},
			500
		);
	}

	const committed = {
		success: true,
		sha: result.sha,
		url: result.url,
		filesCommitted: result.filesCommitted,
	};
	// Either way the sync point is still the old commit, so a pull brings this one in.
	const unfinished = (warning: string): Response => context.json({ ...committed, warning });

	try {
		await storageClient.promoteCommit(projectId, userId, pendingChanges);
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_commit_promote_failed',
			projectId,
			sha: result.sha,
			error: err instanceof Error ? err.message : String(err),
		});
		return unfinished('Committed to GitHub, but the editor\'s copy didn\'t update. Pull to bring the commit in.');
	}

	try {
		await recordCommit(projectId, result.sha!, committedSpecPathChanges(pendingChanges));
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_commit_record_failed',
			projectId,
			sha: result.sha,
			error: err instanceof Error ? err.message : String(err),
		});
		return unfinished('Committed to GitHub, but spec links didn\'t move yet. Pull to finish bringing the commit in.');
	}

	log({
		type: 'github',
		level: 'info',
		event: 'github_commit_success',
		projectId,
		sha: result.sha,
		filesCommitted: result.filesCommitted,
	});

	return context.json(committed);
}
