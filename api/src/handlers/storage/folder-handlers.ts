/**
 * Folder management handlers
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import fs from 'fs/promises';
import { addFolder, removeFolder } from '@doc-platform/db';
import { isValidUUID } from '../../validation.ts';
import { findRepoRoot, getCurrentBranch, getRelativePath } from '../../services/storage/git-utils.ts';
import { getUserId } from './utils.ts';

/**
 * POST /api/projects/:id/folders
 * Add a folder to the project (validates git repository)
 */
export async function handleAddFolder(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const body = await context.req.json();
		const { path } = body;

		if (!path || typeof path !== 'string') {
			return context.json({ error: 'Path is required' }, 400);
		}

		// Validate folder exists
		try {
			const stats = await fs.stat(path);
			if (!stats.isDirectory()) {
				return context.json({ error: 'Path is not a directory', code: 'NOT_DIRECTORY' }, 400);
			}
		} catch (statError: unknown) {
			const err = statError as { code?: string };
			if (err?.code === 'ENOENT') {
				return context.json({ error: 'Folder does not exist', code: 'FOLDER_NOT_FOUND' }, 400);
			}
			if (err?.code === 'EACCES') {
				return context.json({ error: 'Permission denied', code: 'FOLDER_PERMISSION_DENIED' }, 403);
			}
			if (err?.code === 'ENOTDIR') {
				return context.json({ error: 'Path is not a directory', code: 'NOT_DIRECTORY' }, 400);
			}
			console.error('Failed to access folder:', statError);
			return context.json({ error: 'Failed to access folder', code: 'FOLDER_ACCESS_ERROR' }, 400);
		}

		// Find git repository root
		let repoRoot: string | null;
		try {
			repoRoot = await findRepoRoot(path);
		} catch (gitError) {
			console.error('Git error finding repo root:', gitError);
			return context.json(
				{ error: 'Failed to access git repository', code: 'GIT_ERROR' },
				500
			);
		}
		if (!repoRoot) {
			return context.json(
				{ error: 'Folder is not inside a git repository', code: 'NOT_GIT_REPO' },
				400
			);
		}

		// Get current branch
		let branch: string;
		try {
			branch = await getCurrentBranch(repoRoot);
		} catch (gitError) {
			console.error('Git error getting branch:', gitError);
			return context.json(
				{ error: 'Failed to determine git branch', code: 'GIT_BRANCH_ERROR' },
				500
			);
		}

		// Calculate relative path within repo
		const rootPath = getRelativePath(repoRoot, path);

		// Add folder to project
		const project = await addFolder(projectId, userId, {
			repoPath: repoRoot,
			rootPath,
			branch,
		});

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json({
			projectId: project.id,
			storageMode: project.storageMode,
			repository: project.repository,
			rootPaths: project.rootPaths,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (message === 'DIFFERENT_REPO') {
			return context.json(
				{ error: 'Folder must be in the same git repository as existing folders', code: 'DIFFERENT_REPO' },
				400
			);
		}

		if (message === 'DUPLICATE_PATH') {
			return context.json(
				{ error: 'This folder is already added', code: 'DUPLICATE_PATH' },
				400
			);
		}

		if (message === 'MAX_ROOT_PATHS_EXCEEDED') {
			return context.json(
				{ error: 'Maximum number of folders reached (20)', code: 'MAX_ROOT_PATHS_EXCEEDED' },
				400
			);
		}

		console.error('Failed to add folder:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * DELETE /api/projects/:id/folders?path=...
 * Remove a folder from the project (doesn't delete files)
 */
export async function handleRemoveFolder(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const path = context.req.query('path');
	if (!path) {
		return context.json({ error: 'Path query parameter is required', code: 'PATH_REQUIRED' }, 400);
	}

	try {
		const project = await removeFolder(projectId, userId, path);

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json({
			projectId: project.id,
			storageMode: project.storageMode,
			repository: project.repository,
			rootPaths: project.rootPaths,
		});
	} catch (error) {
		console.error('Failed to remove folder:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}
