/**
 * File operation handlers
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { getProject, type RepositoryConfig, isLocalRepository } from '@doc-platform/db';
import { isValidUUID } from '../../validation.js';
import { LocalStorageProvider } from '../../services/storage/local-provider.js';
import type { FileEntry } from '../../services/storage/types.js';
import {
	getUserId,
	getStorageProvider,
	normalizePath,
	isPathWithinRoots,
	type ExpandedTree,
	expandedTreeToPaths,
	pathsToExpandedTree,
	sortPathsByDepth,
	getDisplayName,
} from './utils.js';

const MAX_EXPANDED_PATHS = 200;

/**
 * POST /api/projects/:id/tree
 * Load file tree with expanded paths
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

		// Parse body for expanded tree (POST) or use empty object (GET)
		let expandedTree: ExpandedTree = {};
		if (context.req.method === 'POST') {
			try {
				const body = await context.req.json() as { expanded?: ExpandedTree };
				expandedTree = body.expanded || {};
			} catch {
				// Invalid JSON, use defaults
			}
		}

		// Convert tree to flat paths for processing (with depth limit in utils)
		const requestedExpandedPaths = expandedTreeToPaths(expandedTree);

		if (requestedExpandedPaths.length > MAX_EXPANDED_PATHS) {
			return context.json({ error: `Too many expanded paths (max ${MAX_EXPANDED_PATHS})` }, 400);
		}

		const provider = new LocalStorageProvider(repo.localPath);
		const rootPaths = project.rootPaths || [];

		// Combine root paths with requested expanded paths
		const pathsToExpand = [...new Set([...rootPaths, ...requestedExpandedPaths])];
		const sortedPaths = sortPathsByDepth(pathsToExpand);

		const files: FileEntry[] = [];
		const validExpandedPaths: string[] = [];

		for (const path of sortedPaths) {
			// Validate and normalize path
			const normalized = normalizePath(path);
			if (!normalized) {
				continue; // Skip paths with traversal attempts
			}

			// Add root folder entry if this is a root path
			if (rootPaths.includes(path)) {
				files.push({
					name: getDisplayName(path),
					path: path,
					type: 'directory',
				});
			}

			// Validate path is within roots
			if (!isPathWithinRoots(normalized, rootPaths)) {
				continue;
			}

			// Fetch children
			try {
				const children = await provider.listDirectory(normalized, {
					extensions: ['md', 'mdx'],
				});

				validExpandedPaths.push(path);

				// Insert children after their parent folder
				const parentIndex = files.findIndex((f) => f.path === path);
				if (parentIndex !== -1) {
					files.splice(parentIndex + 1, 0, ...children);
				} else {
					files.push(...children);
				}
			} catch {
				// Path doesn't exist - skip it
			}
		}

		// Convert valid paths back to tree format
		const validExpandedTree = pathsToExpandedTree(validExpandedPaths);

		return context.json({
			files,
			expanded: validExpandedTree,
			rootPaths,
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
 * GET /api/projects/:id/files?path=/docs/file.md
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

	// Get file path from query parameter
	const rawPath = context.req.query('path');
	if (!rawPath) {
		return context.json({ error: 'Path query parameter is required', code: 'PATH_REQUIRED' }, 400);
	}

	// Normalize and validate path
	const filePath = normalizePath(rawPath);
	if (!filePath) {
		return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
	}

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
 * PUT /api/projects/:id/files?path=/docs/file.md
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

	// Get file path from query parameter
	const rawPath = context.req.query('path');
	if (!rawPath) {
		return context.json({ error: 'Path query parameter is required', code: 'PATH_REQUIRED' }, 400);
	}

	// Normalize and validate path
	const filePath = normalizePath(rawPath);
	if (!filePath) {
		return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
	}

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
