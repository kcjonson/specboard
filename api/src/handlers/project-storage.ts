/**
 * Project storage handlers - folder management, file operations, git
 * See /docs/specs/project-storage.md for specification
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import fs from 'fs/promises';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { getProject, addFolder, removeFolder, type RepositoryConfig, isLocalRepository } from '@doc-platform/db';
import { isValidUUID } from '../validation.js';
import { findRepoRoot, getCurrentBranch, getRelativePath } from '../services/storage/git-utils.js';
import { LocalStorageProvider } from '../services/storage/local-provider.js';

async function getUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	return session?.userId ?? null;
}

/**
 * Get a storage provider for a project
 */
async function getStorageProvider(
	projectId: string,
	userId: string
): Promise<LocalStorageProvider | null> {
	const project = await getProject(projectId, userId);
	if (!project) return null;

	const repo = project.repository as RepositoryConfig | Record<string, never>;
	if (!isLocalRepository(repo)) {
		return null; // No repository configured or cloud mode
	}

	return new LocalStorageProvider(repo.localPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Management
// ─────────────────────────────────────────────────────────────────────────────

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
		} catch {
			return context.json({ error: 'Folder does not exist', code: 'FOLDER_NOT_FOUND' }, 400);
		}

		// Find git repository root
		const repoRoot = await findRepoRoot(path);
		if (!repoRoot) {
			return context.json(
				{ error: 'Folder is not inside a git repository', code: 'NOT_GIT_REPO' },
				400
			);
		}

		// Get current branch
		const branch = await getCurrentBranch(repoRoot);

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

		console.error('Failed to add folder:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * DELETE /api/projects/:id/folders
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

	try {
		const body = await context.req.json();
		const { path } = body;

		if (!path || typeof path !== 'string') {
			return context.json({ error: 'Path is required' }, 400);
		}

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

// ─────────────────────────────────────────────────────────────────────────────
// File Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path is within one of the project's root paths
 */
function isPathWithinRoots(targetPath: string, rootPaths: string[]): boolean {
	const normalizedTarget = targetPath.replace(/\/+$/, '') || '/';
	for (const root of rootPaths) {
		const normalizedRoot = root.replace(/\/+$/, '') || '/';
		if (normalizedTarget === normalizedRoot) return true;
		if (normalizedTarget.startsWith(normalizedRoot + '/')) return true;
	}
	return false;
}

/**
 * GET /api/projects/:id/tree
 * List files in the project
 */
export async function handleListFiles(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const project = await getProject(projectId, userId);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		const repo = project.repository as RepositoryConfig | Record<string, never>;
		if (!isLocalRepository(repo)) {
			return context.json({ error: 'No repository configured', code: 'REPO_NOT_CONFIGURED' }, 400);
		}

		const pathParam = context.req.query('path') || '/';

		// Validate path is within configured root paths
		if (!isPathWithinRoots(pathParam, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const provider = new LocalStorageProvider(repo.localPath);

		// List files at the specified path
		const allEntries = await provider.listDirectory(pathParam);

		// Filter to only show directories and markdown files
		const entries = allEntries.filter((entry) => {
			if (entry.type === 'directory') return true;
			const ext = entry.name.toLowerCase().split('.').pop();
			return ext === 'md' || ext === 'mdx';
		});

		return context.json({
			path: pathParam,
			entries,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'TOO_MANY_FILES') {
			return context.json({
				error: 'Directory contains too many files (limit: 1000)',
				code: 'TOO_MANY_FILES',
			}, 400);
		}
		console.error('Failed to list files:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * GET /api/projects/:id/files/*
 * Read a file
 */
export async function handleReadFile(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	// Get file path from URL - everything after /files/
	const url = new URL(context.req.url);
	const match = url.pathname.match(/\/projects\/[^/]+\/files(\/.*)/);
	const filePath = match?.[1] ?? '/';

	try {
		const project = await getProject(projectId, userId);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		const exists = await provider.exists(filePath);
		if (!exists) {
			return context.json({ error: 'File not found' }, 404);
		}

		const content = await provider.readFile(filePath);

		return context.json({
			path: filePath,
			content,
			encoding: 'utf-8',
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'BINARY_FILE') {
			return context.json({ error: 'Cannot read binary file', code: 'BINARY_FILE' }, 400);
		}
		if (message === 'FILE_TOO_LARGE') {
			return context.json({ error: 'File too large (limit: 5MB)', code: 'FILE_TOO_LARGE' }, 400);
		}
		console.error('Failed to read file:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * PUT /api/projects/:id/files/*
 * Write a file
 */
export async function handleWriteFile(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	// Get file path from URL
	const url = new URL(context.req.url);
	const match = url.pathname.match(/\/projects\/[^/]+\/files(\/.*)/);
	const filePath = match?.[1] ?? '/';

	try {
		const project = await getProject(projectId, userId);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const body = await context.req.json();
		const { content } = body;

		if (typeof content !== 'string') {
			return context.json({ error: 'Content is required' }, 400);
		}

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		await provider.writeFile(filePath, content);

		return context.json({
			path: filePath,
			success: true,
		});
	} catch (error) {
		console.error('Failed to write file:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Git Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/projects/:id/git/status
 */
export async function handleGitStatus(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'Project not found or no repository configured' }, 404);
		}

		const status = await provider.status();
		return context.json(status);
	} catch (error) {
		console.error('Failed to get git status:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * GET /api/projects/:id/git/log
 */
export async function handleGitLog(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'Project not found or no repository configured' }, 404);
		}

		const limit = parseInt(context.req.query('limit') || '20', 10);
		const path = context.req.query('path');

		const commits = await provider.log({ limit, path: path || undefined });
		return context.json({ commits });
	} catch (error) {
		console.error('Failed to get git log:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * POST /api/projects/:id/git/commit
 */
export async function handleGitCommit(context: Context, redis: Redis): Promise<Response> {
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
		const { message, paths } = body;

		if (!message || typeof message !== 'string') {
			return context.json({ error: 'Commit message is required' }, 400);
		}

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'Project not found or no repository configured' }, 404);
		}

		// Stage files if paths provided
		if (Array.isArray(paths) && paths.length > 0) {
			await provider.add(paths);
		}

		const sha = await provider.commit(message);
		return context.json({ sha, message });
	} catch (error) {
		console.error('Failed to commit:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * POST /api/projects/:id/git/push
 */
export async function handleGitPush(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'Project not found or no repository configured' }, 404);
		}

		await provider.push();
		return context.json({ pushed: true });
	} catch (error) {
		console.error('Failed to push:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}

/**
 * POST /api/projects/:id/git/pull
 */
export async function handleGitPull(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'Project not found or no repository configured' }, 404);
		}

		const result = await provider.pull();
		return context.json(result);
	} catch (error) {
		console.error('Failed to pull:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}
