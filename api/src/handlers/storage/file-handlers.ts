/**
 * File operation handlers
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { getProject, query } from '@doc-platform/db';
import { isValidUUID } from '../../validation.ts';
import type { FileEntry } from '../../services/storage/types.ts';
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
} from './utils.ts';

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

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			// No repository configured - return empty tree
			return context.json({
				files: [],
				expanded: {},
				rootPaths: [],
			});
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

		const rootPaths = project.rootPaths || [];

		// Combine root paths with requested expanded paths
		const pathsToExpand = [...new Set([...rootPaths, ...requestedExpandedPaths])];
		const sortedPaths = sortPathsByDepth(pathsToExpand);

		const validExpandedPaths: string[] = [];
		// Map from path to its children for efficient tree building
		const childrenByPath = new Map<string, FileEntry[]>();

		for (const pathToExpand of sortedPaths) {
			// Validate and normalize path
			const normalized = normalizePath(pathToExpand);
			if (!normalized) {
				continue; // Skip paths with traversal attempts
			}

			// Validate path is within roots
			if (!isPathWithinRoots(normalized, rootPaths)) {
				continue;
			}

			// Fetch children
			// Only show markdown files - this is a documentation editor, not a general file browser.
			// Binary files, configs, etc. are intentionally excluded to keep the UI focused.
			try {
				const children = await provider.listDirectory(normalized, {
					extensions: ['md', 'mdx'],
				});

				validExpandedPaths.push(pathToExpand);
				childrenByPath.set(pathToExpand, children);
			} catch {
				// Path doesn't exist - skip it
			}
		}

		// Build flat file list by recursively adding children after parents
		const files: FileEntry[] = [];
		const addPathWithChildren = (pathEntry: string): void => {
			// Add root folder entry if this is a root path
			if (rootPaths.includes(pathEntry)) {
				files.push({
					name: getDisplayName(pathEntry),
					path: pathEntry,
					type: 'directory',
				});
			}

			// Add children if this path was expanded
			const children = childrenByPath.get(pathEntry);
			if (children) {
				for (const child of children) {
					files.push(child);
					// Recursively add children of directories
					if (child.type === 'directory') {
						addPathWithChildren(child.path);
					}
				}
			}
		};

		// Start from root paths
		for (const root of rootPaths) {
			addPathWithChildren(root);
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
 * POST /api/projects/:id/files?path=/docs/file.md
 * Create a new file
 */
export async function handleCreateFile(context: Context, redis: Redis): Promise<Response> {
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
	let filePath = normalizePath(rawPath);
	if (!filePath) {
		return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
	}

	// Auto-add .md extension if not present
	if (!filePath.endsWith('.md') && !filePath.endsWith('.mdx')) {
		filePath = filePath + '.md';
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

		// Check if file already exists
		const exists = await provider.exists(filePath);
		if (exists) {
			return context.json({ error: 'File already exists', code: 'FILE_EXISTS' }, 409);
		}

		// Create file with default markdown heading
		await provider.writeFile(filePath, '# Untitled\n\n');

		return context.json({
			path: filePath,
			success: true,
		});
	} catch (error) {
		console.error('Failed to create file:', error);
		return context.json({ error: 'Failed to create file', code: 'FILE_CREATE_FAILED' }, 500);
	}
}

/**
 * PUT /api/projects/:id/files/rename
 * Rename a file
 */
export async function handleRenameFile(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const body = await context.req.json() as { oldPath?: string; newPath?: string };
		const { oldPath: rawOldPath, newPath: rawNewPath } = body;

		if (!rawOldPath || !rawNewPath) {
			return context.json({ error: 'oldPath and newPath are required' }, 400);
		}

		// Normalize paths
		const oldPath = normalizePath(rawOldPath);
		const newPath = normalizePath(rawNewPath);

		if (!oldPath || !newPath) {
			return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
		}

		const project = await getProject(projectId, userId);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		// Validate both paths are within roots
		if (!isPathWithinRoots(oldPath, project.rootPaths)) {
			return context.json({ error: 'Source path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}
		if (!isPathWithinRoots(newPath, project.rootPaths)) {
			return context.json({ error: 'Destination path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		// Check source exists
		const sourceExists = await provider.exists(oldPath);
		if (!sourceExists) {
			return context.json({ error: 'Source file not found' }, 404);
		}

		// Check destination doesn't exist
		const destExists = await provider.exists(newPath);
		if (destExists) {
			return context.json({ error: 'A file with that name already exists', code: 'FILE_EXISTS' }, 409);
		}

		// Rename file first
		await provider.rename(oldPath, newPath);

		// Update any epics that link to this file
		// If this fails, rollback the file rename to maintain consistency
		try {
			await query(
				`UPDATE epics SET spec_doc_path = $1 WHERE project_id = $2 AND spec_doc_path = $3`,
				[newPath, projectId, oldPath]
			);
		} catch (dbError) {
			// Rollback file rename
			console.error('Epic update failed, rolling back file rename:', dbError);
			try {
				await provider.rename(newPath, oldPath);
			} catch (rollbackError) {
				console.error('Rollback failed:', rollbackError);
			}
			return context.json({ error: 'Failed to update epic references' }, 500);
		}

		return context.json({
			oldPath,
			newPath,
			success: true,
		});
	} catch (error) {
		console.error('Failed to rename file:', error);
		return context.json({ error: 'Failed to rename file', code: 'FILE_RENAME_FAILED' }, 500);
	}
}

/**
 * DELETE /api/projects/:id/files?path=/docs/file.md
 * Delete a file or folder
 */
export async function handleDeleteFile(context: Context, redis: Redis): Promise<Response> {
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

		// Don't allow deleting root paths
		if (project.rootPaths.includes(filePath)) {
			return context.json({ error: 'Cannot delete root folder', code: 'CANNOT_DELETE_ROOT' }, 403);
		}

		const provider = await getStorageProvider(projectId, userId);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		// Check file/folder exists
		const exists = await provider.exists(filePath);
		if (!exists) {
			return context.json({ error: 'File or folder not found' }, 404);
		}

		// Delete the file/folder
		await provider.deleteFile(filePath);

		// Clear any epic references to deleted files
		await query(
			`UPDATE epics SET spec_doc_path = NULL WHERE project_id = $1 AND spec_doc_path = $2`,
			[projectId, filePath]
		);

		return context.json({
			path: filePath,
			success: true,
		});
	} catch (error) {
		console.error('Failed to delete file:', error);
		return context.json({ error: 'Failed to delete file', code: 'FILE_DELETE_FAILED' }, 500);
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
