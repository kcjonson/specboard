/**
 * Database queries for storage service.
 */

import { pool, transaction } from './index.ts';

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
	renamedFrom: string | null;
	/** The committed file's content_hash the draft was made against; null when none was committed. */
	baseContentHash: string | null;
	/** The draft's own content hash; null for a deletion (and for drafts from before it was recorded). */
	contentHash: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** A draft as listed: with what's committed at its path now, and whether that moved since the draft began. */
export interface ListedPendingChange extends PendingChange {
	conflict: boolean;
	/** content_hash of the committed file at this path now; null when none is. */
	committedHash: string | null;
}

// ============================================================
// Project Documents (synced from GitHub)
// ============================================================

export async function getProjectDocument(
	projectId: string,
	path: string
): Promise<ProjectDocument | null> {
	const db = pool.instance;
	const result = await db.query<{
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

	const row = result.rows[0];
	if (!row) return null;

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

export interface ListDocumentsOptions {
	limit?: number;
	offset?: number;
}

export interface ListDocumentsResult {
	documents: ProjectDocument[];
	total: number;
}

export async function listProjectDocuments(
	projectId: string,
	options?: ListDocumentsOptions
): Promise<ListDocumentsResult> {
	const db = pool.instance;
	const { limit, offset } = options || {};

	// Get total count
	const countResult = await db.query<{ count: string }>(
		`SELECT COUNT(*) as count FROM project_documents WHERE project_id = $1`,
		[projectId]
	);
	const total = parseInt(countResult.rows[0]?.count || '0', 10);

	// Build query with optional pagination
	let query = `SELECT id, project_id, path, s3_key, content_hash, size_bytes, synced_at
		 FROM project_documents
		 WHERE project_id = $1
		 ORDER BY path`;
	const params: (string | number)[] = [projectId];

	if (limit !== undefined) {
		query += ` LIMIT $${params.length + 1}`;
		params.push(limit);
	}
	if (offset !== undefined) {
		query += ` OFFSET $${params.length + 1}`;
		params.push(offset);
	}

	const result = await db.query<{
		id: string;
		project_id: string;
		path: string;
		s3_key: string;
		content_hash: string;
		size_bytes: number;
		synced_at: Date;
	}>(query, params);

	return {
		documents: result.rows.map((row) => ({
			id: row.id,
			projectId: row.project_id,
			path: row.path,
			s3Key: row.s3_key,
			contentHash: row.content_hash,
			sizeBytes: row.size_bytes,
			syncedAt: row.synced_at,
		})),
		total,
	};
}

export async function upsertProjectDocument(
	projectId: string,
	path: string,
	s3Key: string,
	contentHash: string,
	sizeBytes: number
): Promise<void> {
	const db = pool.instance;
	await db.query(
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
	const db = pool.instance;
	await db.query(
		`DELETE FROM project_documents WHERE project_id = $1 AND path = $2`,
		[projectId, path]
	);
}

// ============================================================
// Pending Changes (uncommitted user edits)
// ============================================================

export async function getPendingChange(
	projectId: string,
	userId: string,
	path: string
): Promise<PendingChange | null> {
	const db = pool.instance;
	const result = await db.query<{
		id: string;
		project_id: string;
		user_id: string;
		path: string;
		content: string | null;
		s3_key: string | null;
		action: 'modified' | 'created' | 'deleted';
		renamed_from: string | null;
		base_content_hash: string | null;
		content_hash: string | null;
		created_at: Date;
		updated_at: Date;
	}>(
		`SELECT id, project_id, user_id, path, content, s3_key, action, renamed_from, base_content_hash, content_hash, created_at, updated_at
		 FROM pending_changes
		 WHERE project_id = $1 AND user_id = $2 AND path = $3`,
		[projectId, userId, path]
	);

	const row = result.rows[0];
	if (!row) return null;

	return {
		id: row.id,
		projectId: row.project_id,
		userId: row.user_id,
		path: row.path,
		content: row.content,
		s3Key: row.s3_key,
		action: row.action,
		renamedFrom: row.renamed_from,
		baseContentHash: row.base_content_hash,
		contentHash: row.content_hash,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * A user's drafts, each with `conflict`: what's committed at its path now differs from
 * what the draft was made against (a changed file, a file deleted under a draft, or a
 * file created where the draft creates one), unless the draft already holds exactly
 * what's committed (the committer's own commit brought in by a pull, say), which would
 * commit as a no-op.
 */
export async function listPendingChanges(
	projectId: string,
	userId: string
): Promise<ListedPendingChange[]> {
	const db = pool.instance;
	const result = await db.query<{
		id: string;
		project_id: string;
		user_id: string;
		path: string;
		content: string | null;
		s3_key: string | null;
		action: 'modified' | 'created' | 'deleted';
		renamed_from: string | null;
		base_content_hash: string | null;
		content_hash: string | null;
		committed_hash: string | null;
		conflict: boolean;
		created_at: Date;
		updated_at: Date;
	}>(
		`SELECT p.id, p.project_id, p.user_id, p.path, p.content, p.s3_key, p.action, p.renamed_from,
		        p.base_content_hash, p.content_hash, d.content_hash AS committed_hash,
		        p.base_content_hash IS DISTINCT FROM d.content_hash
		          AND NOT (p.action <> 'deleted' AND COALESCE(p.content_hash = d.content_hash, false)) AS conflict,
		        p.created_at, p.updated_at
		 FROM pending_changes p
		 LEFT JOIN project_documents d ON d.project_id = p.project_id AND d.path = p.path
		 WHERE p.project_id = $1 AND p.user_id = $2
		 ORDER BY p.path`,
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
		renamedFrom: row.renamed_from,
		baseContentHash: row.base_content_hash,
		contentHash: row.content_hash,
		committedHash: row.committed_hash,
		conflict: row.conflict,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

/**
 * What the draft's content was made against: `{ given: true, hash }` when the writer
 * says (the editor sends the committed hash it loaded, or null for a file nothing was
 * committed at), `{ given: false }` when it doesn't (a deletion, a rename, an agent's
 * write, an older client), which falls back to what's committed at the path then.
 */
export type DraftBase = { given: true; hash: string | null } | { given: false };

export async function upsertPendingChange(
	projectId: string,
	userId: string,
	path: string,
	content: string | null,
	s3Key: string | null,
	action: 'modified' | 'created' | 'deleted',
	renamedFrom: string | null,
	base: DraftBase = { given: false },
	contentHash: string | null = null
): Promise<void> {
	const db = pool.instance;
	// Saving a renamed file again doesn't name where it came from, so an existing origin
	// is kept unless the write gives one; a deletion has none. The base is set when the
	// draft row is first written and later saves keep it.
	await db.query(
		`INSERT INTO pending_changes (project_id, user_id, path, content, s3_key, action, renamed_from, base_content_hash, content_hash, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'deleted' THEN NULL ELSE $7 END,
		         CASE WHEN $8::boolean THEN $9
		              ELSE (SELECT content_hash FROM project_documents WHERE project_id = $1 AND path = $3) END,
		         $10, NOW(), NOW())
		 ON CONFLICT (project_id, user_id, path) DO UPDATE SET
		   content = EXCLUDED.content,
		   s3_key = EXCLUDED.s3_key,
		   action = EXCLUDED.action,
		   content_hash = EXCLUDED.content_hash,
		   renamed_from = CASE
		     WHEN EXCLUDED.action = 'deleted' THEN NULL
		     ELSE COALESCE(EXCLUDED.renamed_from, pending_changes.renamed_from)
		   END,
		   updated_at = NOW()`,
		[projectId, userId, path, content, s3Key, action, renamedFrom, base.given, base.given ? base.hash : null, contentHash]
	);
}

/**
 * A hash a writer may name as a draft's base: a committed file's sha1, or the marker
 * migration 003 gave drafts whose file was already gone.
 */
export function isDraftBaseHash(value: unknown): value is string {
	return typeof value === 'string' && (/^[0-9a-f]{40}$/.test(value) || value === 'missing-before-migration');
}

/**
 * Undo a rename in one go: drop the draft at the new path and the deletion at the old
 * one, so the file is back as committed. Returns the dropped rows that kept content in S3.
 */
export async function undoPendingRename(
	projectId: string,
	userId: string,
	oldPath: string,
	newPath: string
): Promise<Array<{ path: string; s3Key: string }>> {
	return transaction(async (client) => {
		const dropped = await client.query<{ path: string; s3_key: string | null }>(
			`DELETE FROM pending_changes
			 WHERE project_id = $1 AND user_id = $2 AND path = ANY($3)
			 RETURNING path, s3_key`,
			[projectId, userId, [oldPath, newPath]]
		);
		return dropped.rows.flatMap((row) => (row.s3_key ? [{ path: row.path, s3Key: row.s3_key }] : []));
	});
}

export async function deletePendingChange(
	projectId: string,
	userId: string,
	path: string
): Promise<void> {
	const db = pool.instance;
	await db.query(
		`DELETE FROM pending_changes WHERE project_id = $1 AND user_id = $2 AND path = $3`,
		[projectId, userId, path]
	);
}

/** A committed file's new metadata; its content is already at its S3 key. */
export interface PromotedDocument {
	path: string;
	s3Key: string;
	contentHash: string;
	sizeBytes: number;
}

/** A pending change the commit took, as it was when the commit read it. */
export interface CommittedPendingChange {
	path: string;
	/** The change's updatedAt as the commit read it (millisecond precision). */
	updatedAt: string;
}

/**
 * Make a commit the project's committed files, in one transaction: upsert what it
 * wrote, remove what it deleted, and clear the committer's pending changes it took. A
 * pending change saved again after the commit read it no longer matches its updatedAt
 * and stays pending. Returns the cleared changes that kept their content in S3.
 */
export async function promoteCommit(
	projectId: string,
	userId: string,
	written: PromotedDocument[],
	deleted: string[],
	taken: CommittedPendingChange[]
): Promise<Array<{ path: string; s3Key: string }>> {
	return transaction(async (client) => {
		for (const doc of written) {
			await client.query(
				`INSERT INTO project_documents (project_id, path, s3_key, content_hash, size_bytes, synced_at)
				 VALUES ($1, $2, $3, $4, $5, NOW())
				 ON CONFLICT (project_id, path) DO UPDATE SET
				   s3_key = EXCLUDED.s3_key,
				   content_hash = EXCLUDED.content_hash,
				   size_bytes = EXCLUDED.size_bytes,
				   synced_at = NOW()`,
				[projectId, doc.path, doc.s3Key, doc.contentHash, doc.sizeBytes]
			);
		}
		if (deleted.length > 0) {
			await client.query(
				'DELETE FROM project_documents WHERE project_id = $1 AND path = ANY($2)',
				[projectId, deleted]
			);
		}
		const cleared = await client.query<{ path: string; s3_key: string | null }>(
			`DELETE FROM pending_changes p
			 USING unnest($3::text[], $4::timestamptz[]) AS c(path, updated_at)
			 WHERE p.project_id = $1 AND p.user_id = $2 AND p.path = c.path
			   AND date_trunc('milliseconds', p.updated_at) = c.updated_at
			 RETURNING p.path, p.s3_key`,
			[projectId, userId, taken.map((t) => t.path), taken.map((t) => t.updatedAt)]
		);
		// A draft the committer saved again mid-commit was made on top of what they just
		// committed, so that's its base now, not the version before.
		await client.query(
			`UPDATE pending_changes p
			 SET base_content_hash = (SELECT content_hash FROM project_documents d WHERE d.project_id = p.project_id AND d.path = p.path)
			 WHERE p.project_id = $1 AND p.user_id = $2 AND p.path = ANY($3)`,
			[projectId, userId, taken.map((t) => t.path)]
		);
		return cleared.rows.flatMap((row) => (row.s3_key ? [{ path: row.path, s3Key: row.s3_key }] : []));
	});
}

/**
 * "Keep mine" for conflicting drafts: make what's committed at each path now the
 * draft's base, so the commit takes the draft as it is. A draft that writes the file
 * becomes `created` or `modified` to match whether a file is committed there now; a
 * deletion of a file that's already gone has nothing left to do and is dropped.
 */
export async function rebasePendingChanges(
	projectId: string,
	userId: string,
	paths: string[]
): Promise<{ rebased: string[]; dropped: string[] }> {
	return transaction(async (client) => {
		const dropped = await client.query<{ path: string }>(
			`DELETE FROM pending_changes p
			 WHERE p.project_id = $1 AND p.user_id = $2 AND p.path = ANY($3) AND p.action = 'deleted'
			   AND NOT EXISTS (SELECT 1 FROM project_documents d WHERE d.project_id = p.project_id AND d.path = p.path)
			 RETURNING p.path`,
			[projectId, userId, paths]
		);
		const rebased = await client.query<{ path: string }>(
			`UPDATE pending_changes p
			 SET base_content_hash = d.content_hash,
			     action = CASE
			       WHEN p.action = 'deleted' THEN 'deleted'
			       WHEN d.content_hash IS NULL THEN 'created'
			       ELSE 'modified'
			     END
			 FROM (SELECT unnest($3::text[]) AS path) wanted
			 LEFT JOIN project_documents d ON d.project_id = $1 AND d.path = wanted.path
			 WHERE p.project_id = $1 AND p.user_id = $2 AND p.path = wanted.path
			 RETURNING p.path`,
			[projectId, userId, paths]
		);
		return { rebased: rebased.rows.map((r) => r.path), dropped: dropped.rows.map((r) => r.path) };
	});
}

/**
 * Check if content should be stored inline or in S3.
 */
export function shouldStoreInS3(content: string): boolean {
	return Buffer.byteLength(content, 'utf8') > INLINE_THRESHOLD;
}
