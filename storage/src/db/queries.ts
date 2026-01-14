/**
 * Database queries for storage service.
 */

import { getPool } from './index.ts';

// Size threshold for inline storage vs S3
const INLINE_THRESHOLD = 100 * 1024; // 100KB

// ============================================================
// Types
// ============================================================

export interface ProjectDocument {
	id: string;
	projectId: string;
	path: string;
	s3Key: string;
	contentHash: string;
	sizeBytes: number;
	syncedAt: Date;
}

export interface PendingChange {
	id: string;
	projectId: string;
	userId: string;
	path: string;
	content: string | null;
	s3Key: string | null;
	action: 'modified' | 'created' | 'deleted';
	createdAt: Date;
	updatedAt: Date;
}

// ============================================================
// Project Documents (synced from GitHub)
// ============================================================

export async function getProjectDocument(
	projectId: string,
	path: string
): Promise<ProjectDocument | null> {
	const pool = getPool();
	const result = await pool.query<{
		id: string;
		project_id: string;
		path: string;
		s3_key: string;
		content_hash: string;
		size_bytes: number;
		synced_at: Date;
	}>(
		`SELECT id, project_id, path, s3_key, content_hash, size_bytes, synced_at
		 FROM project_documents
		 WHERE project_id = $1 AND path = $2`,
		[projectId, path]
	);

	if (result.rows.length === 0) return null;

	const row = result.rows[0];
	return {
		id: row.id,
		projectId: row.project_id,
		path: row.path,
		s3Key: row.s3_key,
		contentHash: row.content_hash,
		sizeBytes: row.size_bytes,
		syncedAt: row.synced_at,
	};
}

export async function listProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
	const pool = getPool();
	const result = await pool.query<{
		id: string;
		project_id: string;
		path: string;
		s3_key: string;
		content_hash: string;
		size_bytes: number;
		synced_at: Date;
	}>(
		`SELECT id, project_id, path, s3_key, content_hash, size_bytes, synced_at
		 FROM project_documents
		 WHERE project_id = $1
		 ORDER BY path`,
		[projectId]
	);

	return result.rows.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		path: row.path,
		s3Key: row.s3_key,
		contentHash: row.content_hash,
		sizeBytes: row.size_bytes,
		syncedAt: row.synced_at,
	}));
}

export async function upsertProjectDocument(
	projectId: string,
	path: string,
	s3Key: string,
	contentHash: string,
	sizeBytes: number
): Promise<void> {
	const pool = getPool();
	await pool.query(
		`INSERT INTO project_documents (project_id, path, s3_key, content_hash, size_bytes, synced_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())
		 ON CONFLICT (project_id, path) DO UPDATE SET
		   s3_key = EXCLUDED.s3_key,
		   content_hash = EXCLUDED.content_hash,
		   size_bytes = EXCLUDED.size_bytes,
		   synced_at = NOW()`,
		[projectId, path, s3Key, contentHash, sizeBytes]
	);
}

export async function deleteProjectDocument(projectId: string, path: string): Promise<void> {
	const pool = getPool();
	await pool.query(
		`DELETE FROM project_documents WHERE project_id = $1 AND path = $2`,
		[projectId, path]
	);
}

export async function deleteAllProjectDocuments(projectId: string): Promise<void> {
	const pool = getPool();
	await pool.query(`DELETE FROM project_documents WHERE project_id = $1`, [projectId]);
}

// ============================================================
// Pending Changes (uncommitted user edits)
// ============================================================

export async function getPendingChange(
	projectId: string,
	userId: string,
	path: string
): Promise<PendingChange | null> {
	const pool = getPool();
	const result = await pool.query<{
		id: string;
		project_id: string;
		user_id: string;
		path: string;
		content: string | null;
		s3_key: string | null;
		action: 'modified' | 'created' | 'deleted';
		created_at: Date;
		updated_at: Date;
	}>(
		`SELECT id, project_id, user_id, path, content, s3_key, action, created_at, updated_at
		 FROM pending_changes
		 WHERE project_id = $1 AND user_id = $2 AND path = $3`,
		[projectId, userId, path]
	);

	if (result.rows.length === 0) return null;

	const row = result.rows[0];
	return {
		id: row.id,
		projectId: row.project_id,
		userId: row.user_id,
		path: row.path,
		content: row.content,
		s3Key: row.s3_key,
		action: row.action,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listPendingChanges(
	projectId: string,
	userId: string
): Promise<PendingChange[]> {
	const pool = getPool();
	const result = await pool.query<{
		id: string;
		project_id: string;
		user_id: string;
		path: string;
		content: string | null;
		s3_key: string | null;
		action: 'modified' | 'created' | 'deleted';
		created_at: Date;
		updated_at: Date;
	}>(
		`SELECT id, project_id, user_id, path, content, s3_key, action, created_at, updated_at
		 FROM pending_changes
		 WHERE project_id = $1 AND user_id = $2
		 ORDER BY path`,
		[projectId, userId]
	);

	return result.rows.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		userId: row.user_id,
		path: row.path,
		content: row.content,
		s3Key: row.s3_key,
		action: row.action,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

export async function upsertPendingChange(
	projectId: string,
	userId: string,
	path: string,
	content: string | null,
	s3Key: string | null,
	action: 'modified' | 'created' | 'deleted'
): Promise<void> {
	const pool = getPool();
	await pool.query(
		`INSERT INTO pending_changes (project_id, user_id, path, content, s3_key, action, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		 ON CONFLICT (project_id, user_id, path) DO UPDATE SET
		   content = EXCLUDED.content,
		   s3_key = EXCLUDED.s3_key,
		   action = EXCLUDED.action,
		   updated_at = NOW()`,
		[projectId, userId, path, content, s3Key, action]
	);
}

export async function deletePendingChange(
	projectId: string,
	userId: string,
	path: string
): Promise<void> {
	const pool = getPool();
	await pool.query(
		`DELETE FROM pending_changes WHERE project_id = $1 AND user_id = $2 AND path = $3`,
		[projectId, userId, path]
	);
}

export async function deleteAllPendingChanges(projectId: string, userId: string): Promise<void> {
	const pool = getPool();
	await pool.query(
		`DELETE FROM pending_changes WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
}

/**
 * Check if content should be stored inline or in S3.
 */
export function shouldStoreInS3(content: string): boolean {
	return Buffer.byteLength(content, 'utf8') > INLINE_THRESHOLD;
}
