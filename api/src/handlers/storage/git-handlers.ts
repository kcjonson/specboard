/**
 * Git operation handlers. requireProjectAccess has authorized the caller before any of these run.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { getStorageProvider, normalizePath } from './utils.ts';
import { handleGitHubCommit, handleGitHubSync } from '../github-sync.ts';
import { isCloudRepository, isLocalRepository, type RepositoryConfig } from '@specboard/db';
import { apiUserId, loadAuthorizedProject, requireAccess } from '../../project-access.ts';
import { jsonObjectBody } from '../../request-body.ts';
import { isConventionFile, invalidateRepoConventions } from '../../prompts/repo-conventions.ts';

/**
 * GET /api/projects/:owner/:project/git/status
 * Get git status including branch, ahead/behind, and changed files
 *
 * Works for both local and cloud mode projects:
 * - Local: Returns actual git status (branch, staged/unstaged files)
 * - Cloud: Returns pending changes tracked in storage service
 */
export async function handleGetGitStatus(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	// Get project first to verify it exists and check mode
	let project;
	try {
		project = await loadAuthorizedProject(context);
	} catch (error) {
		console.error('Failed to get project:', error);
		return context.json({ error: 'Failed to load project' }, 500);
	}

	if (!project) {
		return context.json({ error: 'Project not found' }, 404);
	}

	// Get storage provider based on project mode
	const provider = getStorageProvider(project, userId, access);
	if (!provider) {
		// No storage configured (storage_mode: 'none'), or a member of a local project
		return context.json({ error: 'Project has no storage configured' }, 400);
	}

	try {
		const status = await provider.status();

		// Combine staged, unstaged, and untracked into a single changedFiles array
		// Use a Map to dedupe by path, preferring staged status
		const changedMap = new Map<string, { path: string; status: string; isUntracked: boolean }>();

		// Add staged files
		for (const file of status.staged) {
			changedMap.set(file.path, { path: file.path, status: file.status, isUntracked: false });
		}

		// Add unstaged files (don't override if already staged)
		for (const file of status.unstaged) {
			if (!changedMap.has(file.path)) {
				changedMap.set(file.path, { path: file.path, status: file.status, isUntracked: false });
			}
		}

		// Add untracked files
		for (const path of status.untracked) {
			if (!changedMap.has(path)) {
				changedMap.set(path, { path, status: 'added', isUntracked: true });
			}
		}

		return context.json({
			branch: status.branch,
			ahead: status.ahead,
			behind: status.behind,
			changedFiles: Array.from(changedMap.values()),
		});
	} catch (error) {
		console.error('Failed to get git status:', error);
		return context.json({ error: 'Failed to get git status' }, 500);
	}
}

/**
 * POST /api/projects/:owner/:project/git/commit
 * Commit all changes with optional message
 * Auto-generates message if not provided
 *
 * For cloud-mode projects, this delegates to the GitHub commit handler.
 */
export async function handleCommit(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	// Check project mode - must be either cloud or local, never ambiguous
	let project;
	try {
		project = await loadAuthorizedProject(context);
	} catch (error) {
		console.error('Failed to get project:', error);
		return context.json({ error: 'Failed to load project' }, 500);
	}

	if (!project) {
		return context.json({ error: 'Project not found' }, 404);
	}

	// Route based on project storage mode
	const repo = project.repository as RepositoryConfig | Record<string, never>;
	if (isCloudRepository(repo)) {
		return handleGitHubCommit(context);
	}

	// Local storage mode - get storage provider
	const provider = getStorageProvider(project, userId, access);
	if (!provider) {
		return context.json({ error: 'No repository configured' }, 404);
	}

	try {
		// Parse request body
		let message: string | undefined;
		try {
			const body = await context.req.json() as { message?: string };
			message = body.message;
		} catch {
			// No body or invalid JSON - that's fine, we'll auto-generate
		}

		// Get current status to check for changes and generate message
		const status = await provider.status();

		// Dedupe by path - a file may appear in both staged and unstaged
		const changesMap = new Map<string, { path: string; status: string }>();
		for (const file of status.staged) {
			changesMap.set(file.path, file);
		}
		for (const file of status.unstaged) {
			if (!changesMap.has(file.path)) {
				changesMap.set(file.path, file);
			}
		}
		for (const path of status.untracked) {
			if (!changesMap.has(path)) {
				changesMap.set(path, { path, status: 'added' });
			}
		}
		const allChanges = Array.from(changesMap.values());

		if (allChanges.length === 0) {
			return context.json({ error: 'No changes to commit' }, 400);
		}

		// Generate commit message if not provided
		if (!message) {
			message = generateCommitMessage(allChanges);
		}

		// Stage all changes
		const allPaths = allChanges.map((c) => c.path);
		await provider.add(allPaths);

		// Commit
		let sha: string;
		try {
			sha = await provider.commit(message);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return context.json({
				success: false,
				error: { stage: 'commit', message: errorMessage },
			});
		}

		// Push
		try {
			await provider.push();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return context.json({
				success: false,
				sha,
				error: { stage: 'push', message: errorMessage },
			});
		}

		return context.json({
			success: true,
			sha,
			message,
			filesCommitted: allChanges.length,
		});
	} catch (error) {
		console.error('Commit failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return context.json({
			success: false,
			error: { stage: 'commit', message: errorMessage },
		}, 500);
	}
}

/**
 * POST /api/projects/:owner/:project/git/restore
 * Restore a file to its committed version.
 *
 * Local mode restores from git; cloud mode discards the file's pending
 * change, leaving the committed content in place.
 */
export async function handleRestore(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	const body = await jsonObjectBody<{ path?: unknown }>(context);
	if (body instanceof Response) return body;
	if (!body.path || typeof body.path !== 'string') {
		return context.json({ error: 'Path is required', code: 'PATH_REQUIRED' }, 400);
	}
	const filePath = normalizePath(body.path);
	if (!filePath) {
		return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
	}

	// Get project and check mode - restore only works for local mode
	let project;
	try {
		project = await loadAuthorizedProject(context);
	} catch (error) {
		console.error('Failed to get project:', error);
		return context.json({ error: 'Failed to load project' }, 500);
	}

	if (!project) {
		return context.json({ error: 'Project not found' }, 404);
	}
	const projectId = project.id;

	// Local mode restores from git; cloud mode discards the pending change,
	// restoring the committed version. Both go through provider.restore().
	const provider = getStorageProvider(project, userId, access);
	if (!provider) {
		return context.json({ error: 'Project has no storage configured' }, 400);
	}

	try {
		await provider.restore(filePath);

		// Invalidate convention file cache if a convention file was restored
		if (isConventionFile(filePath)) {
			await invalidateRepoConventions(projectId, userId, redis);
		}

		return context.json({
			success: true,
			path: filePath,
		});
	} catch (error) {
		console.error('Restore failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return context.json({ error: `Restore failed: ${errorMessage}` }, 500);
	}
}

/**
 * POST /api/projects/:owner/:project/git/pull
 * Pull latest changes from remote
 *
 * For local mode: Runs git pull
 * For cloud mode: Delegates to GitHub incremental sync
 */
export async function handlePull(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	// Get project and check mode
	let project;
	try {
		project = await loadAuthorizedProject(context);
	} catch (error) {
		console.error('Failed to get project:', error);
		return context.json({ error: 'Failed to load project' }, 500);
	}

	if (!project) {
		return context.json({ error: 'Project not found' }, 404);
	}
	const projectId = project.id;

	const repo = project.repository as RepositoryConfig | Record<string, never>;

	// Cloud mode: delegate to GitHub sync (incremental)
	if (isCloudRepository(repo)) {
		return handleGitHubSync(context);
	}

	// Must be local mode
	if (!isLocalRepository(repo)) {
		return context.json({ error: 'Project has no storage configured' }, 400);
	}

	const provider = getStorageProvider(project, userId, access);
	if (!provider) {
		return context.json({ error: 'Project has no storage configured' }, 400);
	}

	try {
		const result = await provider.pull();

		if (!result.pulled) {
			return context.json({
				success: false,
				error: 'Pull failed',
			});
		}

		// Invalidate cached repo conventions after successful pull
		await invalidateRepoConventions(projectId, userId, redis);

		return context.json({
			success: true,
			commits: result.commits,
		});
	} catch (error) {
		console.error('Pull failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return context.json({
			success: false,
			error: errorMessage,
		});
	}
}

/**
 * Generate a commit message from changed files
 */
function generateCommitMessage(changes: Array<{ path: string; status: string }>): string {
	const fileNames = changes
		.slice(0, 3)
		.map((c) => c.path.split('/').pop())
		.filter(Boolean);

	// Fallback if no file names could be extracted
	if (fileNames.length === 0) {
		return `Update ${changes.length} file${changes.length === 1 ? '' : 's'}`;
	}

	const extra = changes.length > 3 ? ` (+${changes.length - 3} more)` : '';
	return `Update: ${fileNames.join(', ')}${extra}`;
}
