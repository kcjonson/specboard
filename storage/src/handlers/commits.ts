/**
 * Commit promotion: make a commit the API just landed on GitHub the project's committed
 * files. POST /commits/:projectId/:userId
 *
 * Only the API calls this, from its commit handler, once GitHub has accepted the
 * commit; the API's editor gate on that route is the authorization.
 */

import { Hono } from 'hono';
import crypto from 'crypto';

import { getPendingChange, getProjectDocument, promoteCommit, type PromotedDocument } from '../db/queries.ts';
import { fileKey, putFileContent, deleteFileContent, deletePendingContent } from '../services/s3.ts';
import { validatePath } from './utils.ts';

type Action = 'modified' | 'created' | 'deleted';

interface CommittedChange {
	path: string;
	action: Action;
	content: string | null;
	updatedAt: string;
}

const ACTIONS: Action[] = ['modified', 'created', 'deleted'];

/** The body's changes with validated paths, or the reason they're refused. */
function parseChanges(body: unknown): CommittedChange[] | string {
	const changes = (body as { changes?: unknown } | null)?.changes;
	if (!Array.isArray(changes) || changes.length === 0) return 'changes must be a non-empty array';

	const out: CommittedChange[] = [];
	const seen = new Set<string>();
	for (const raw of changes as Array<Partial<CommittedChange>>) {
		const path = typeof raw.path === 'string' ? validatePath(raw.path) : null;
		if (!path) return 'Invalid path';
		if (seen.has(path)) return `Duplicate path: ${path}`;
		seen.add(path);
		if (!raw.action || !ACTIONS.includes(raw.action)) return `Invalid action for ${path}`;
		if (raw.action !== 'deleted' && typeof raw.content !== 'string') return `Content required for ${path}`;
		if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) {
			return `Invalid updatedAt for ${path}`;
		}
		out.push({
			path,
			action: raw.action,
			content: raw.action === 'deleted' ? null : (raw.content as string),
			updatedAt: raw.updatedAt,
		});
	}
	return out;
}

export const commitRoutes = new Hono();

/**
 * Write the committed content, then in one transaction point the committed files at it,
 * remove the deleted ones, and clear the committer's pending changes the commit took.
 *
 * Content goes to S3 first, under each file's own key. If the transaction then fails,
 * those keys already hold what GitHub has, the rows and pending changes are untouched,
 * and the API leaves the sync point where it was so the next pull brings the commit in.
 */
commitRoutes.post('/:projectId/:userId', async (c) => {
	const projectId = c.req.param('projectId');
	const userId = c.req.param('userId');

	const changes = parseChanges(await c.req.json().catch(() => null));
	if (typeof changes === 'string') {
		return c.json({ error: changes }, 400);
	}

	console.log(JSON.stringify({
		type: 'audit',
		timestamp: new Date().toISOString(),
		action: 'commit:promote',
		projectId,
		userId,
		paths: changes.map((change) => change.path),
	}));

	const written: PromotedDocument[] = [];
	for (const change of changes) {
		if (change.content === null) continue;
		await putFileContent(projectId, change.path, change.content);
		written.push({
			path: change.path,
			s3Key: fileKey(projectId, change.path),
			contentHash: crypto.createHash('sha1').update(change.content).digest('hex'),
			sizeBytes: Buffer.byteLength(change.content, 'utf8'),
		});
	}
	const deleted = changes.filter((change) => change.action === 'deleted').map((change) => change.path);

	const clearedLarge = await promoteCommit(
		projectId,
		userId,
		written,
		deleted,
		changes.map((change) => ({ path: change.path, updatedAt: change.updatedAt }))
	);

	// The rows are gone, so nothing reads these objects any more, unless a write since
	// the transaction (a sync, another commit, a new draft) brought the path back and
	// reuses the same key: skip any path with a live row again. A failure only leaves an
	// orphan behind.
	for (const path of deleted) {
		if (await getProjectDocument(projectId, path)) continue;
		await deleteFileContent(projectId, path).catch((err) => console.warn(`Failed to delete S3 content for ${path}:`, err));
	}
	for (const { path } of clearedLarge) {
		if (await getPendingChange(projectId, userId, path)) continue;
		await deletePendingContent(projectId, userId, path).catch((err) => console.warn(`Failed to delete pending S3 content for ${path}:`, err));
	}

	return c.json({ written: written.length, deleted: deleted.length });
});
