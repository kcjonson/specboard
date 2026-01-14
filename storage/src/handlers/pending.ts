/**
 * Pending changes handlers.
 * GET/PUT/DELETE /pending/:projectId/:userId/*path
 */

import { Hono } from 'hono';

import {
	getPendingChange,
	listPendingChanges,
	upsertPendingChange,
	deletePendingChange,
	deleteAllPendingChanges,
	shouldStoreInS3,
} from '../db/queries.ts';
import {
	getPendingContent,
	putPendingContent,
	deletePendingContent,
} from '../services/s3.ts';
import { validatePath } from './utils.ts';

/**
 * Audit log for pending changes access.
 * Logs all operations for security monitoring.
 */
function auditLog(action: string, projectId: string, userId: string, path?: string): void {
	console.log(JSON.stringify({
		type: 'audit',
		timestamp: new Date().toISOString(),
		action: `pending:${action}`,
		projectId,
		userId,
		path: path || null,
	}));
}

export const pendingRoutes = new Hono();

/**
 * List all pending changes for a user in a project.
 * GET /pending/:projectId/:userId
 */
pendingRoutes.get('/:projectId/:userId', async (c) => {
	const projectId = c.req.param('projectId');
	const userId = c.req.param('userId');
	auditLog('list', projectId, userId);

	const changes = await listPendingChanges(projectId, userId);

	// For changes stored in S3, we don't return content here (caller must fetch individually)
	return c.json({
		changes: changes.map((change) => ({
			path: change.path,
			action: change.action,
			hasContent: change.content !== null || change.s3Key !== null,
			isLarge: change.s3Key !== null,
			updatedAt: change.updatedAt.toISOString(),
		})),
	});
});

/**
 * Get pending change content.
 * GET /pending/:projectId/:userId/*path
 */
pendingRoutes.get('/:projectId/:userId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const userId = c.req.param('userId');
	const path = c.req.param('*');

	if (!path) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	auditLog('read', projectId, userId, validPath);

	const change = await getPendingChange(projectId, userId, validPath);
	if (!change) {
		return c.json({ error: 'Pending change not found' }, 404);
	}

	// Get content from inline storage or S3
	let content: string | null = change.content;
	if (change.s3Key) {
		content = await getPendingContent(projectId, userId, validPath);
	}

	return c.json({
		path: change.path,
		content,
		action: change.action,
		updatedAt: change.updatedAt.toISOString(),
	});
});

/**
 * Store pending change.
 * PUT /pending/:projectId/:userId/*path
 */
pendingRoutes.put('/:projectId/:userId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const userId = c.req.param('userId');
	const path = c.req.param('*');

	if (!path || path.length === 0) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	const body = await c.req.json<{
		content?: string;
		action: 'modified' | 'created' | 'deleted';
	}>();

	if (!body.action || !['modified', 'created', 'deleted'].includes(body.action)) {
		return c.json({ error: 'Valid action required (modified, created, deleted)' }, 400);
	}

	// For delete action, content is not required
	if (body.action !== 'deleted' && typeof body.content !== 'string') {
		return c.json({ error: 'Content required for modified/created actions' }, 400);
	}

	auditLog('write', projectId, userId, validPath);

	let inlineContent: string | null = null;
	let s3Key: string | null = null;

	if (body.content) {
		if (shouldStoreInS3(body.content)) {
			// Store large content in S3
			await putPendingContent(projectId, userId, validPath, body.content);
			s3Key = `${projectId}/pending/${userId}/${validPath}`;
		} else {
			// Store small content inline
			inlineContent = body.content;
		}
	}

	// Update database - if this fails after S3 upload, clean up S3
	try {
		await upsertPendingChange(projectId, userId, validPath, inlineContent, s3Key, body.action);
	} catch (err) {
		// Clean up S3 content if DB update failed
		if (s3Key) {
			try {
				await deletePendingContent(projectId, userId, validPath);
			} catch {
				// Ignore cleanup errors - original error is more important
			}
		}
		throw err;
	}

	return c.json({
		path: validPath,
		action: body.action,
		isLarge: s3Key !== null,
	});
});

/**
 * Delete pending change.
 * DELETE /pending/:projectId/:userId/*path
 */
pendingRoutes.delete('/:projectId/:userId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const userId = c.req.param('userId');
	const path = c.req.param('*');

	if (!path || path.length === 0) {
		// Delete all pending changes for this user in this project
		auditLog('delete-all', projectId, userId);
		const changes = await listPendingChanges(projectId, userId);

		// Delete from database first to avoid orphaned metadata
		await deleteAllPendingChanges(projectId, userId);

		// Best-effort S3 cleanup - failures here don't affect the already-deleted DB records
		for (const change of changes) {
			if (change.s3Key) {
				try {
					await deletePendingContent(projectId, userId, change.path);
				} catch {
					// Log but continue - DB records are already deleted
					console.warn(`Failed to delete S3 content for ${change.path}`);
				}
			}
		}

		return c.json({ deleted: true, count: changes.length });
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	auditLog('delete', projectId, userId, validPath);

	// Check if change exists and has S3 content
	const change = await getPendingChange(projectId, userId, validPath);
	const hadS3Content = change?.s3Key;

	// Delete from database first to avoid orphaned metadata
	await deletePendingChange(projectId, userId, validPath);

	// Then delete S3 content if it existed
	if (hadS3Content) {
		await deletePendingContent(projectId, userId, validPath);
	}

	return c.json({ deleted: true });
});
