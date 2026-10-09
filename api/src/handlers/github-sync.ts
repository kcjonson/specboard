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
import { isInSkippedDirectory } from '@specboard/core/sync-paths';
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
 * The project's sync lock is free when nothing holds it (no status, or the last holder
 * finished) or when the holder has gone quiet for longer than any sync or commit runs:
 * a Lambda stops at 15 minutes and a commit request well before, so 20 minutes means it
 * crashed without releasing. Lock tokens are millisecond timestamps so they survive the
 * round trip through a JS Date.
 */
const SYNC_LOCK_FREE = `(sync_status IS NULL OR sync_status IN ('completed', 'failed')
	OR sync_started_at IS NULL OR sync_started_at < NOW() - interval '20 minutes')`;
const LOCK_TOKEN = `date_trunc('milliseconds', clock_timestamp())`;

/** What a caller hears when the sync lock is taken. */
const LOCK_BUSY_MESSAGE = 'A sync or a commit is running. Try again when it finishes.';

/**
 * Take the sync lock for a pull or a first sync (status 'pending'; the Lambda moves it
 * to 'syncing' with this token, which travels in its event). Null when a sync or a
 * commit holds it.
 */
export async function trySetSyncPending(projectId: string): Promise<Date | null> {
	const result = await query<{ token: Date }>(
		`UPDATE projects
		 SET sync_status = 'pending', sync_error = NULL, sync_started_at = ${LOCK_TOKEN}
		 WHERE id = $1 AND ${SYNC_LOCK_FREE}
		 RETURNING sync_started_at AS token`,
		[projectId]
	);
	return result.rows[0]?.token ?? null;
}

/** A commit's hold on the sync lock: the status to put back, and the token that proves it's still ours. */
export interface CommitLock {
	previous: string | null;
	token: Date;
}

/**
 * Take the sync lock for a commit (status 'committing'), so a pull can't move files or
 * the sync point under it. Null when a sync or another commit holds it.
 */
export async function tryStartCommit(projectId: string): Promise<CommitLock | null> {
	const result = await query<{ previous: string | null; token: Date }>(
		`WITH prev AS (SELECT id AS project_id, sync_status AS previous FROM projects WHERE id = $1 FOR UPDATE)
		 UPDATE projects
		 SET sync_status = 'committing', sync_started_at = ${LOCK_TOKEN}
		 FROM prev
		 WHERE id = prev.project_id AND ${SYNC_LOCK_FREE}
		 RETURNING prev.previous, sync_started_at AS token`,
		[projectId]
	);
	const row = result.rows[0];
	return row ? { previous: row.previous, token: row.token } : null;
}

/**
 * Release a commit's lock, unless it went stale and someone else holds it now. A
 * finished previous state (none, completed, failed) is put back. A held one means this
 * commit took the lock over from a holder that died, so it isn't put back (it would
 * read as freshly held for another 20 minutes); the project shows that sync as failed.
 */
export async function finishCommit(projectId: string, lock: CommitLock): Promise<void> {
	const settled = lock.previous === null || lock.previous === 'completed' || lock.previous === 'failed';
	await query(
		`UPDATE projects
		 SET sync_status = $2,
		     sync_error = CASE WHEN $4::text IS NULL THEN sync_error ELSE $4 END,
		     sync_completed_at = CASE WHEN $4::text IS NULL THEN sync_completed_at ELSE NOW() END
		 WHERE id = $1 AND sync_status = 'committing' AND sync_started_at = $3`,
		[projectId, settled ? lock.previous : 'failed', lock.token, settled ? null : 'The last sync didn\'t finish. Pull again.']
	);
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

	const lockToken = await trySetSyncPending(projectId);
	if (!lockToken) {
		throw new Error(LOCK_BUSY_MESSAGE);
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
			lockToken: lockToken.toISOString(),
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
	const lockToken = await trySetSyncPending(projectId);
	if (!lockToken) {
		return context.json({ error: LOCK_BUSY_MESSAGE }, 409);
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
			lockToken: lockToken.toISOString(),
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
	const lockToken = await trySetSyncPending(projectId);
	if (!lockToken) {
		return context.json({ success: false, error: LOCK_BUSY_MESSAGE }, 409);
	}
	// The sync starts from the sync point as it is under the lock: a commit that
	// finished between the read above and taking the lock has moved it.
	const lastCommitSha = (await getProjectWithRepo(projectId))?.lastSyncedCommitSha;
	if (!lastCommitSha) {
		await query(`UPDATE projects SET sync_status = NULL WHERE id = $1`, [projectId]);
		return context.json({ success: false, error: 'Initial sync required. Use POST /sync/initial first.' }, 400);
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
			lastCommitSha,
			lockToken: lockToken.toISOString(),
		};

		await invokeSyncLambda(payload);

		log({
			type: 'github',
			level: 'info',
			event: 'github_incremental_sync_started',
			projectId,
			owner: project.owner,
			repo: project.repo,
			lastCommitSha,
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

/** A full commit SHA; anything shorter can't be GitHub's expectedHeadOid. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** What the editor shows when drafts were made against files someone has changed since. */
export const DRAFT_CONFLICTS_MESSAGE = 'Some files you changed were also changed by someone else since you started. Keep your version or discard it for each one, then commit.';

/** How many times to try recording a commit GitHub and storage already have. */
const RECORD_ATTEMPTS = 3;

/**
 * Commit pending changes to GitHub repository.
 * POST /api/projects/:owner/:project/github/commit
 *
 * Holds the project's sync lock throughout (sync_status 'committing'), so no pull moves
 * files or the sync point in between:
 *
 * 1. Read the caller's pending changes from the storage service
 * 2. Create the commit with GitHub's createCommitOnBranch, expecting the branch to be at
 *    the project's last synced commit: if anything landed since, GitHub refuses, the
 *    answer is 409 (pull first), and nothing here changes
 * 3. Promote the commit into storage: its files become the committed files and the
 *    pending changes it took are cleared, in one storage transaction
 * 4. Move spec links for what it renamed and deleted and the sync point to it, in one
 *    compare-and-set transaction, retried a few times
 *
 * Steps 3 and 4 run after GitHub has the commit, so a failure there can't undo it. If
 * either fails the sync point stays at the old commit and the answer is success with a
 * warning: the next pull brings the commit in like any other push (docs/specs/
 * project-storage.md, Committing, for what that recovers and what it can't).
 */
export async function handleGitHubCommit(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const projectId = requireResolvedProject(context).id;

	if (!(await getProjectWithRepo(projectId))) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
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

	const lock = await tryStartCommit(projectId);
	if (!lock) {
		return context.json({
			success: false,
			error: { stage: 'commit', message: LOCK_BUSY_MESSAGE },
		}, 409);
	}
	try {
		return await commitLocked(context, projectId, userId, accessToken);
	} finally {
		await finishCommit(projectId, lock);
	}
}

/** The commit itself, run while the caller holds the project's sync lock. */
async function commitLocked(context: Context, projectId: string, userId: string, accessToken: string): Promise<Response> {
	// Read under the lock, so the sync point can't move between here and step 4.
	const project = await getProjectWithRepo(projectId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	// Drafts are made against the last synced commit. A missing or abbreviated one (an
	// older full sync stored the archive's short SHA) can't be checked against; a pull
	// stores the full SHA.
	const expectedHeadOid = project.lastSyncedCommitSha;
	if (!expectedHeadOid || !FULL_SHA.test(expectedHeadOid)) {
		return context.json({
			success: false,
			error: {
				stage: 'commit',
				message: expectedHeadOid
					? 'Pull first, then commit again.'
					: 'The repository hasn\'t finished its first sync yet.',
			},
			conflictDetected: Boolean(expectedHeadOid),
		}, 409);
	}

	// Two checks before anything goes to GitHub, read from one listing of the drafts and
	// one of the committed files. Commits and pulls hold the same lock, so neither can
	// change between here and GitHub; expectedHeadOid covers pushes from outside.
	const storageClient = getStorageClient();
	let drafts;
	let unavailable: Set<string>;
	try {
		const [listed, files] = await Promise.all([
			storageClient.listPendingChanges(projectId, userId),
			storageClient.listFiles(projectId),
		]);
		drafts = listed;
		unavailable = new Set(files.filter((file) => file.unavailable).map((file) => file.path));
	} catch (err) {
		log({
			type: 'storage',
			level: 'error',
			event: 'list_pending_changes_failed',
			userId,
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ success: false, error: { stage: 'commit', message: 'Failed to load pending changes. Please try again.' } }, 500);
	}

	// First, drafts the sync could never bring back as written: one over a file the editor
	// can't hold (a sync found it binary or over its size limit since the draft began), a
	// rename of such a file (the stale text would land under the new name and the real
	// file would be deleted), or one in a directory syncs skip. Each would leave GitHub
	// ahead of storage under a sync point that claims otherwise; no "keep mine" can make
	// them right, so they're reported before conflicts. Deleting is fine.
	const unsyncable = drafts.flatMap((change): Array<{ path: string; why: 'unavailable' | 'not_synced' }> => {
		if (change.action === 'deleted') return [];
		if (unavailable.has(change.path) || (change.renamedFrom !== null && unavailable.has(change.renamedFrom))) {
			return [{ path: '/' + change.path, why: 'unavailable' }];
		}
		if (isInSkippedDirectory(change.path)) return [{ path: '/' + change.path, why: 'not_synced' }];
		return [];
	});
	if (unsyncable.length > 0) {
		const paths = unsyncable.map((file) => file.path).join(', ');
		return context.json({
			success: false,
			reason: 'unavailable_files',
			files: unsyncable,
			error: {
				stage: 'commit',
				message: `These files can't be committed from here: ${paths}. A file that's binary or larger than 500 KB on the branch, or that's in a folder the sync skips, has to be changed in the repository directly. Discard your changes to them, then commit.`,
			},
		}, 409);
	}

	// Then, a draft is the whole file, so one made against a committed version that has
	// since changed would replace that change wholesale. Refuse until the caller keeps or
	// discards each one.
	const conflicts = drafts.filter((change) => change.conflict);
	if (conflicts.length > 0) {
		return context.json({
			success: false,
			reason: 'draft_conflicts',
			conflicts: conflicts.map((change) => ({ path: '/' + change.path, action: change.action })),
			error: { stage: 'commit', message: DRAFT_CONFLICTS_MESSAGE },
		}, 409);
	}

	// Get pending changes with content
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
		// The drafts the commit took, so an editor holding one of them open knows its
		// next save is made against the version just committed.
		paths: pendingChanges.map((change) => '/' + change.path),
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

	// Safe to retry: it's a compare-and-set on the sync point, and a try that landed
	// before its reply was lost reads as recorded.
	const linkChanges = committedSpecPathChanges(pendingChanges);
	let recorded = false;
	for (let attempt = 1; attempt <= RECORD_ATTEMPTS && !recorded; attempt++) {
		try {
			if (!(await recordCommit(projectId, expectedHeadOid, result.sha!, linkChanges))) {
				log({ type: 'github', level: 'error', event: 'github_commit_sync_point_moved', projectId, sha: result.sha });
				return unfinished('Committed to GitHub, but the sync point moved underneath it. Pull to bring the commit in.');
			}
			recorded = true;
		} catch (err) {
			log({
				type: 'github',
				level: 'error',
				event: 'github_commit_record_failed',
				projectId,
				sha: result.sha,
				attempt,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	if (!recorded) {
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
