/**
 * Git operation handlers
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { isValidUUID } from '../../validation.js';
import { getUserId, getStorageProvider } from './utils.js';

/**
 * GET /api/projects/:id/git/status
 * Get git status including branch, ahead/behind, and changed files
 */
export async function handleGetGitStatus(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const provider = await getStorageProvider(projectId, userId);
	if (!provider) {
		return context.json({ error: 'No repository configured' }, 404);
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
 * POST /api/projects/:id/git/commit
 * Commit all changes with optional message
 * Auto-generates message if not provided
 */
export async function handleCommit(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const provider = await getStorageProvider(projectId, userId);
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
 * POST /api/projects/:id/git/restore
 * Restore a deleted file from git
 */
export async function handleRestore(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const provider = await getStorageProvider(projectId, userId);
	if (!provider) {
		return context.json({ error: 'No repository configured' }, 404);
	}

	try {
		const body = await context.req.json() as { path?: string };
		const filePath = body.path;

		if (!filePath || typeof filePath !== 'string') {
			return context.json({ error: 'Path is required' }, 400);
		}

		await provider.restore(filePath);

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
 * POST /api/projects/:id/git/pull
 * Pull latest changes from remote
 */
export async function handlePull(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const provider = await getStorageProvider(projectId, userId);
	if (!provider) {
		return context.json({ error: 'No repository configured' }, 404);
	}

	try {
		const result = await provider.pull();

		if (!result.pulled) {
			return context.json({
				success: false,
				error: 'Pull failed',
			});
		}

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
