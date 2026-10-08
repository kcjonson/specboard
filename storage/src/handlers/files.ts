/**
 * File storage handlers.
 * GET/PUT/DELETE /files/:projectId/:path
 */

import { Hono } from 'hono';
import crypto from 'crypto';

import {
	getProjectDocument,
	listProjectDocuments,
	upsertProjectDocument,
	deleteProjectDocument,
	markDocumentUnavailable,
	type UnavailableReason,
} from '../db/queries.ts';
import {
	getFileContent,
	putFileContent,
	deleteFileContent,
	fileKey,
} from '../services/s3.ts';
import { validatePath } from './utils.ts';

/**
 * Audit log for storage access.
 * Logs all file operations for security monitoring.
 */
function auditLog(action: string, projectId: string, path?: string): void {
	console.log(JSON.stringify({
		type: 'audit',
		timestamp: new Date().toISOString(),
		action,
		projectId,
		path: path || null,
	}));
}

export const filesRoutes = new Hono();

/**
 * List all files for a project.
 * GET /files/:projectId?limit=100&offset=0
 */
filesRoutes.get('/:projectId', async (c) => {
	const projectId = c.req.param('projectId');
	auditLog('list', projectId);

	// Parse optional pagination params
	const limitParam = c.req.query('limit');
	const offsetParam = c.req.query('offset');
	const limit = limitParam ? parseInt(limitParam, 10) : undefined;
	const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

	const result = await listProjectDocuments(projectId, { limit, offset });

	return c.json({
		files: result.documents.map((f) => ({
			path: f.path,
			contentHash: f.contentHash,
			sizeBytes: f.sizeBytes,
			syncedAt: f.syncedAt.toISOString(),
			unavailable: f.unavailable,
		})),
		total: result.total,
	});
});

const UNAVAILABLE_REASONS: UnavailableReason[] = ['too_large', 'binary'];

/**
 * Record that a file on the branch can't be held here (a sync found it binary or over
 * its size limit), and drop whatever older content was stored for it.
 * POST /files/:projectId/unavailable { path, reason, contentHash, sizeBytes }
 */
filesRoutes.post('/:projectId/unavailable', async (c) => {
	const projectId = c.req.param('projectId');
	const body = await c.req.json<{ path?: unknown; reason?: unknown; contentHash?: unknown; sizeBytes?: unknown }>().catch(() => null);

	const validPath = typeof body?.path === 'string' ? validatePath(body.path) : null;
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}
	const reason = body?.reason as UnavailableReason;
	if (!UNAVAILABLE_REASONS.includes(reason)) {
		return c.json({ error: 'reason must be too_large or binary' }, 400);
	}
	if (typeof body?.contentHash !== 'string' || body.contentHash.length === 0) {
		return c.json({ error: 'contentHash required' }, 400);
	}
	if (typeof body?.sizeBytes !== 'number' || !Number.isInteger(body.sizeBytes) || body.sizeBytes < 0) {
		return c.json({ error: 'sizeBytes must be a non-negative integer' }, 400);
	}

	auditLog('mark-unavailable', projectId, validPath);
	await markDocumentUnavailable(projectId, validPath, fileKey(projectId, validPath), reason, body.contentHash, body.sizeBytes);

	// The row no longer points at content, so nothing reads this; a failure only leaves an orphan.
	await deleteFileContent(projectId, validPath).catch((err) => console.warn(`Failed to delete S3 content for ${validPath}:`, err));

	return c.json({ path: validPath, unavailable: reason });
});

/**
 * Get file content.
 * GET /files/:projectId/:path
 */
filesRoutes.get('/:projectId/:path{.+}', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('path');

	if (!path || path.length === 0) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	auditLog('read', projectId, validPath);

	// Check if document exists in database
	const file = await getProjectDocument(projectId, validPath);
	if (!file) {
		return c.json({ error: 'File not found' }, 404);
	}

	// On the branch, but not something the editor can hold: no content to give.
	if (file.unavailable) {
		return c.json({
			path: file.path,
			content: null,
			contentHash: file.contentHash,
			sizeBytes: file.sizeBytes,
			syncedAt: file.syncedAt.toISOString(),
			unavailable: file.unavailable,
		});
	}

	// Get content from S3
	const content = await getFileContent(projectId, validPath);
	if (content === null) {
		return c.json({ error: 'File content not found' }, 404);
	}

	return c.json({
		path: file.path,
		content,
		contentHash: file.contentHash,
		sizeBytes: file.sizeBytes,
		syncedAt: file.syncedAt.toISOString(),
	});
});

/**
 * Store file content.
 * PUT /files/:projectId/:path
 */
filesRoutes.put('/:projectId/:path{.+}', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('path');

	if (!path || path.length === 0) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	auditLog('write', projectId, validPath);

	const body = await c.req.json<{ content: string; contentHash?: string }>();
	if (typeof body.content !== 'string') {
		return c.json({ error: 'Content must be a string' }, 400);
	}

	// Calculate content hash if not provided
	const contentHash =
		body.contentHash || crypto.createHash('sha1').update(body.content).digest('hex');
	const sizeBytes = Buffer.byteLength(body.content, 'utf8');
	const s3Key = fileKey(projectId, validPath);

	// Store in S3 first
	await putFileContent(projectId, validPath, body.content);

	// Update database record - if this fails, clean up S3 to avoid orphaned objects
	try {
		await upsertProjectDocument(projectId, validPath, s3Key, contentHash, sizeBytes);
	} catch (err) {
		// Best-effort cleanup - original error is more important
		try {
			await deleteFileContent(projectId, validPath);
		} catch {
			// Ignore cleanup errors
		}
		throw err;
	}

	return c.json({
		path: validPath,
		contentHash,
		sizeBytes,
	});
});

/**
 * Delete file.
 * DELETE /files/:projectId/:path
 */
filesRoutes.delete('/:projectId/:path{.+}', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('path');

	if (!path || path.length === 0) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	auditLog('delete', projectId, validPath);

	// Delete from database first to avoid orphaned metadata if S3 delete fails
	await deleteProjectDocument(projectId, validPath);

	// Then delete from S3
	await deleteFileContent(projectId, validPath);

	return c.json({ deleted: true });
});
