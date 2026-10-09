/**
 * File operation handlers. requireProjectAccess has authorized the caller before any of these run.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { applySpecPathChanges, isLocalRepository } from '@specboard/db';
import { apiUserId, loadAuthorizedProject, requireAccess } from '../../project-access.ts';
import { jsonObjectBody } from '../../request-body.ts';
import { isConventionFile, invalidateRepoConventions } from '../../prompts/repo-conventions.ts';
import type { FileEntry } from '../../services/storage/types.ts';
import {
	getStorageProvider,
	normalizePath,
	isPathWithinRoots,
	type ExpandedTree,
	expandedTreeToPaths,
	pathsToExpandedTree,
	sortPathsByDepth,
	getDisplayName,
	readDraftBase,
	fileUnavailableResponse,
	notSyncedPathResponse,
} from './utils.ts';

const MAX_EXPANDED_PATHS = 200;

/**
 * POST /api/projects/:owner/:project/tree
 * Load file tree with expanded paths
 */
export async function handleListFiles(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	try {
		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		const provider = getStorageProvider(project, userId, access);
		if (!provider) {
			// No repository configured (or a member of a local project) - return empty tree
			return context.json({
				files: [],
				expanded: {},
				rootPaths: [],
				syncStatus: project.syncStatus ?? null,
				syncError: project.syncError ?? null,
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
			syncStatus: project.syncStatus ?? null,
			syncError: project.syncError ?? null,
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
 * GET /api/projects/:owner/:project/files?path=/docs/file.md
 * Read a file
 */
export async function handleReadFile(context: Context): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

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
		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const provider = getStorageProvider(project, userId, access);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		const exists = await provider.exists(filePath);
		if (!exists) {
			return context.json({ error: 'File not found' }, 404);
		}

		const document = await provider.readDocument(filePath);

		return context.json({
			path: filePath,
			content: document.content,
			encoding: 'utf-8',
			// What an editor sends back with its saves, so a draft records what it was
			// made against rather than whatever is committed when it first saves.
			...(document.baseContentHash === undefined ? {} : { baseContentHash: document.baseContentHash }),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const unavailable = fileUnavailableResponse(context, error);
		if (unavailable) return unavailable;
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
 * POST /api/projects/:owner/:project/files?path=/docs/file.md
 * Create a new file
 */
export async function handleCreateFile(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

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
		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		const projectId = project.id;

		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const notSynced = notSyncedPathResponse(context, project, filePath);
		if (notSynced) return notSynced;

		const provider = getStorageProvider(project, userId, access);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		// Check if file already exists
		const exists = await provider.exists(filePath);
		if (exists) {
			return context.json({ error: 'File already exists', code: 'FILE_EXISTS' }, 409);
		}

		// Create file with default markdown heading; nothing is committed at the path.
		await provider.writeFile(filePath, '# Untitled\n\n', null);

		// Invalidate convention file cache if a convention file was created
		if (isConventionFile(filePath)) {
			await invalidateRepoConventions(projectId, userId, redis);
		}

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
 * PUT /api/projects/:owner/:project/files/rename
 * Rename a file
 */
export async function handleRenameFile(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

	const body = await jsonObjectBody<{ oldPath?: string; newPath?: string; baseContentHash?: unknown }>(context);
	if (body instanceof Response) return body;
	const { oldPath: rawOldPath, newPath: rawNewPath } = body;
	if (!rawOldPath || !rawNewPath) {
		return context.json({ error: 'oldPath and newPath are required' }, 400);
	}
	// What the caller last saw of the source (the open document's base, or the tree's
	// hash for it), so the rename's old side conflicts if someone changed it since.
	const sourceBase = readDraftBase(body.baseContentHash);
	if (!sourceBase.ok) {
		return context.json({ error: 'Invalid baseContentHash', code: 'INVALID_BASE' }, 400);
	}

	try {
		// Normalize paths
		const oldPath = normalizePath(rawOldPath);
		const newPath = normalizePath(rawNewPath);

		if (!oldPath || !newPath) {
			return context.json({ error: 'Invalid path', code: 'INVALID_PATH' }, 400);
		}

		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		const projectId = project.id;

		// Validate both paths are within roots
		if (!isPathWithinRoots(oldPath, project.rootPaths)) {
			return context.json({ error: 'Source path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}
		if (!isPathWithinRoots(newPath, project.rootPaths)) {
			return context.json({ error: 'Destination path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const notSynced = notSyncedPathResponse(context, project, newPath);
		if (notSynced) return notSynced;

		const provider = getStorageProvider(project, userId, access);
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

		await provider.rename(oldPath, newPath, sourceBase.base);

		// A local rename is on disk now, so spec links follow it now, and a failure puts
		// the file back. A cloud rename is the caller's draft until they commit it; the
		// commit moves the links (handleGitHubCommit).
		if (isLocalRepository(project.repository)) {
			try {
				await applySpecPathChanges(projectId, { renamed: [{ from: oldPath, to: newPath }], deleted: [] });
			} catch (dbError) {
				console.error('Spec link update failed, rolling back file rename:', dbError);
				try {
					await provider.rename(newPath, oldPath);
				} catch (rollbackError) {
					console.error('Rollback failed:', rollbackError);
				}
				return context.json({ error: 'Failed to update spec links' }, 500);
			}
		}

		// Invalidate convention file cache if a convention file was renamed to/from
		if (isConventionFile(oldPath) || isConventionFile(newPath)) {
			await invalidateRepoConventions(projectId, userId, redis);
		}

		return context.json({
			oldPath,
			newPath,
			success: true,
		});
	} catch (error) {
		const unavailable = fileUnavailableResponse(context, error);
		if (unavailable) return unavailable;
		console.error('Failed to rename file:', error);
		return context.json({ error: 'Failed to rename file', code: 'FILE_RENAME_FAILED' }, 500);
	}
}

/**
 * DELETE /api/projects/:owner/:project/files?path=/docs/file.md
 * Delete a file or folder
 */
export async function handleDeleteFile(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

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

	// What the caller last saw of the file, so the deletion conflicts if someone changed
	// it since. A delete without one (a tree entry from before hashes were listed) is
	// taken as intent for the path as it's committed now.
	const deleteBase = readDraftBase(context.req.query('baseContentHash'));
	if (!deleteBase.ok) {
		return context.json({ error: 'Invalid baseContentHash', code: 'INVALID_BASE' }, 400);
	}

	try {
		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		const projectId = project.id;

		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		// Don't allow deleting root paths
		if (project.rootPaths.includes(filePath)) {
			return context.json({ error: 'Cannot delete root folder', code: 'CANNOT_DELETE_ROOT' }, 403);
		}

		const provider = getStorageProvider(project, userId, access);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		// Check file/folder exists
		const exists = await provider.exists(filePath);
		if (!exists) {
			return context.json({ error: 'File or folder not found' }, 404);
		}

		await provider.deleteFile(filePath, deleteBase.base);

		// Same split as a rename: a local delete drops the file's spec links now, a cloud
		// delete is a draft whose commit drops them.
		if (isLocalRepository(project.repository)) {
			await applySpecPathChanges(projectId, { renamed: [], deleted: [filePath] });
		}

		// Invalidate convention file cache if a convention file was deleted
		if (isConventionFile(filePath)) {
			await invalidateRepoConventions(projectId, userId, redis);
		}

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
 * PUT /api/projects/:owner/:project/files?path=/docs/file.md
 * Write a file
 */
export async function handleWriteFile(context: Context, redis: Redis): Promise<Response> {
	const userId = apiUserId(context);
	const access = requireAccess(context);

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

	const body = await jsonObjectBody<{ content?: unknown; baseContentHash?: unknown }>(context);
	if (body instanceof Response) return body;
	const { content } = body;
	if (typeof content !== 'string') {
		return context.json({ error: 'Content is required' }, 400);
	}

	// The committed version the content was made against, as GET files gave it (null:
	// nothing committed). A write without it (an agent, an older client) leaves the
	// base to what's committed when the draft is first written.
	const writeBase = readDraftBase(body.baseContentHash);
	if (!writeBase.ok) {
		return context.json({ error: 'Invalid baseContentHash', code: 'INVALID_BASE' }, 400);
	}
	const baseContentHash = writeBase.base;

	try {
		const project = await loadAuthorizedProject(context);
		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}
		const projectId = project.id;

		// Validate path is within configured root paths
		if (!isPathWithinRoots(filePath, project.rootPaths)) {
			return context.json({ error: 'Path is outside project boundaries', code: 'PATH_OUTSIDE_ROOTS' }, 403);
		}

		const notSynced = notSyncedPathResponse(context, project, filePath);
		if (notSynced) return notSynced;

		const provider = getStorageProvider(project, userId, access);
		if (!provider) {
			return context.json({ error: 'No repository configured' }, 404);
		}

		await provider.writeFile(filePath, content, baseContentHash);

		// Invalidate convention file cache if a convention file was edited
		if (isConventionFile(filePath)) {
			await invalidateRepoConventions(projectId, userId, redis);
		}

		return context.json({
			path: filePath,
			success: true,
		});
	} catch (error) {
		const unavailable = fileUnavailableResponse(context, error);
		if (unavailable) return unavailable;
		console.error('Failed to write file:', error);
		return context.json({ error: 'Server error' }, 500);
	}
}
