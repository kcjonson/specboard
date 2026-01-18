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
} from '../db/queries.ts';
import {
	getFileContent,
	putFileContent,
	deleteFileContent,
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
		})),
		total: result.total,
	});
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
	const s3Key = `${projectId}/files/${validPath}`;

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
