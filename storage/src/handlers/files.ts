/**
 * File storage handlers.
 * GET/PUT/DELETE /files/:projectId/*path
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

export const filesRoutes = new Hono();

/**
 * List all files for a project.
 * GET /files/:projectId
 */
filesRoutes.get('/:projectId', async (c) => {
	const projectId = c.req.param('projectId');

	const files = await listProjectDocuments(projectId);

	return c.json({
		files: files.map((f) => ({
			path: f.path,
			contentHash: f.contentHash,
			sizeBytes: f.sizeBytes,
			syncedAt: f.syncedAt.toISOString(),
		})),
	});
});

/**
 * Get file content.
 * GET /files/:projectId/*path
 */
filesRoutes.get('/:projectId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('*');

	if (!path) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

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
 * PUT /files/:projectId/*path
 */
filesRoutes.put('/:projectId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('*');

	if (!path) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	const body = await c.req.json<{ content: string; contentHash?: string }>();
	if (typeof body.content !== 'string') {
		return c.json({ error: 'Content required' }, 400);
	}

	// Calculate content hash if not provided
	const contentHash =
		body.contentHash || crypto.createHash('sha1').update(body.content).digest('hex');
	const sizeBytes = Buffer.byteLength(body.content, 'utf8');
	const s3Key = `${projectId}/files/${validPath}`;

	// Store in S3
	await putFileContent(projectId, validPath, body.content);

	// Update database record
	await upsertProjectDocument(projectId, validPath, s3Key, contentHash, sizeBytes);

	return c.json({
		path: validPath,
		contentHash,
		sizeBytes,
	});
});

/**
 * Delete file.
 * DELETE /files/:projectId/*path
 */
filesRoutes.delete('/:projectId/*', async (c) => {
	const projectId = c.req.param('projectId');
	const path = c.req.param('*');

	if (!path) {
		return c.json({ error: 'Path required' }, 400);
	}

	const validPath = validatePath(path);
	if (!validPath) {
		return c.json({ error: 'Invalid path' }, 400);
	}

	// Delete from S3
	await deleteFileContent(projectId, validPath);

	// Delete from database
	await deleteProjectDocument(projectId, validPath);

	return c.json({ deleted: true });
});
