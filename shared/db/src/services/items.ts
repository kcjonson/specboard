/**
 * Item service — unified business logic for all work items (epic/task/bug).
 *
 * An item has an optional `parent_id`: top-level items (parent_id NULL) are epics,
 * standalone tasks, or standalone bugs; nested items are an item's children. Children
 * are themselves items, so the same operations apply at every level.
 */

import { query } from '../index.ts';
import type { Item, ItemType, ItemStatus, SubStatus, SpecType } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChildStats {
	total: number;
	done: number;
	inProgress: number;
	blocked: number;
}

export interface SpecSummary {
	id: string;
	path: string;
	type: SpecType;
	createdAt: Date;
}

export interface ItemSummary {
	id: string;
	type: ItemType;
	title: string;
	status: ItemStatus;
	description: string | null;
	note: string | null;
}

export interface ProgressNoteSummary {
	id: string;
	note: string;
	createdBy: string;
	createdAt: Date;
}

export interface ItemResponse {
	id: string;
	parentId: string | null;
	type: ItemType;
	title: string;
	description: string | null;
	status: ItemStatus;
	subStatus: SubStatus | null;
	creator: string | null;
	assignee: string | null;
	rank: number;
	dueDate: Date | null;
	prUrl: string | null;
	branchName: string | null;
	notes: string | null;
	note: string | null;
	createdAt: Date;
	updatedAt: Date;
	childStats: ChildStats;
}

export interface ItemWithChildren extends ItemResponse {
	children: ItemSummary[];
}

export interface ItemWithDetails extends ItemWithChildren {
	progressNotes: ProgressNoteSummary[];
	specs: SpecSummary[];
}

export interface CreateItemInput {
	title: string;
	type?: ItemType;
	parentId?: string | null;
	description?: string;
	status?: ItemStatus;
	creator?: string;
	rank?: number;
}

export interface UpdateItemInput {
	title?: string;
	description?: string;
	status?: ItemStatus;
	subStatus?: SubStatus;
	rank?: number;
	prUrl?: string;
	branchName?: string;
	notes?: string;
	note?: string;
}

export interface GetItemsParams {
	projectId: string;
	itemId?: string;
	status?: ItemStatus;
	type?: ItemType;
	search?: string;
	includeChildren?: boolean;
	includeNotes?: boolean;
	includeSpecs?: boolean;
	limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function transformItem(item: Item): Omit<ItemResponse, 'childStats'> {
	return {
		id: item.id,
		parentId: item.parent_id,
		type: item.type,
		title: item.title,
		description: item.description,
		status: item.status,
		subStatus: item.sub_status,
		creator: item.creator,
		assignee: item.assignee,
		rank: item.rank,
		dueDate: item.due_date,
		prUrl: item.pr_url,
		branchName: item.branch_name,
		notes: item.notes,
		note: item.note,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
	};
}

function summarizeItem(item: Item): ItemSummary {
	return {
		id: item.id,
		type: item.type,
		title: item.title,
		status: item.status,
		description: item.description,
		note: item.note,
	};
}

/** Derive board status from sub_status at key transitions, or undefined for no forced transition. */
function deriveStatusFromSubStatus(subStatus: SubStatus): ItemStatus | undefined {
	switch (subStatus) {
		case 'scoping':
		case 'in_development':
		case 'pr_open':
			return 'in_progress';
		case 'complete':
			return 'done';
		default:
			return undefined;
	}
}

/** Derive a consistent sub_status from a board status when creating with a non-default status. */
function deriveSubStatusFromStatus(status: ItemStatus): SubStatus {
	switch (status) {
		case 'in_progress': return 'in_development';
		case 'in_review': return 'pr_open';
		case 'done': return 'complete';
		default: return 'not_started';
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────────────────────────────────────────

/** Verify an item belongs to the project. Replaces the old epic/task ownership checks. */
export async function verifyItemOwnership(projectId: string, itemId: string): Promise<boolean> {
	const result = await query(
		'SELECT id FROM items WHERE id = $1 AND project_id = $2',
		[itemId, projectId]
	);
	return result.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

type ItemWithCounts = Item & {
	child_count: string;
	done_count: string;
	in_progress_count: string;
	blocked_count: string;
};

/**
 * Query top-level items (parent_id IS NULL) with child stats, or a single item by id.
 * Optionally include each item's children, progress notes, and spec links.
 */
export async function getItems(params: GetItemsParams): Promise<ItemWithDetails[]> {
	const { projectId, itemId, status, type, search, includeChildren, includeNotes, includeSpecs, limit = 25 } = params;

	let sql = `
		SELECT i.*,
			COUNT(c.id) as child_count,
			COUNT(c.id) FILTER (WHERE c.status = 'done') as done_count,
			COUNT(c.id) FILTER (WHERE c.status = 'in_progress') as in_progress_count,
			COUNT(c.id) FILTER (WHERE c.status = 'blocked') as blocked_count
		FROM items i
		LEFT JOIN items c ON c.parent_id = i.id
		WHERE i.project_id = $1
	`;
	const queryParams: unknown[] = [projectId];
	let paramIndex = 2;

	if (itemId) {
		sql += ` AND i.id = $${paramIndex}`;
		queryParams.push(itemId);
		paramIndex++;
	} else {
		// Lists show top-level items only; children surface via includeChildren.
		sql += ` AND i.parent_id IS NULL`;
		if (status) {
			sql += ` AND i.status = $${paramIndex}`;
			queryParams.push(status);
			paramIndex++;
		}
		if (type) {
			sql += ` AND i.type = $${paramIndex}`;
			queryParams.push(type);
			paramIndex++;
		}
		if (search) {
			sql += ` AND (i.title ILIKE $${paramIndex} OR i.description ILIKE $${paramIndex})`;
			queryParams.push(`%${search}%`);
			paramIndex++;
		}
	}

	sql += ` GROUP BY i.id ORDER BY i.rank ASC`;
	if (!itemId) {
		sql += ` LIMIT $${paramIndex}`;
		queryParams.push(limit);
	}

	const result = await query<ItemWithCounts>(sql, queryParams);
	const itemIds = result.rows.map((r) => r.id);

	const childrenByParent = new Map<string, Item[]>();
	if (includeChildren && itemIds.length > 0) {
		const childResult = await query<Item>(
			'SELECT * FROM items WHERE parent_id = ANY($1) ORDER BY rank ASC',
			[itemIds]
		);
		for (const child of childResult.rows) {
			if (!child.parent_id) continue;
			const existing = childrenByParent.get(child.parent_id) || [];
			existing.push(child);
			childrenByParent.set(child.parent_id, existing);
		}
	}

	const notesByItem = new Map<string, ProgressNoteSummary[]>();
	if (includeNotes && itemIds.length > 0) {
		const notesResult = await query<{ id: string; item_id: string; note: string; created_by: string; created_at: Date }>(
			'SELECT * FROM progress_notes WHERE item_id = ANY($1) ORDER BY created_at DESC',
			[itemIds]
		);
		for (const n of notesResult.rows) {
			const existing = notesByItem.get(n.item_id) || [];
			existing.push({ id: n.id, note: n.note, createdBy: n.created_by, createdAt: n.created_at });
			notesByItem.set(n.item_id, existing);
		}
	}

	const specsByItem = new Map<string, SpecSummary[]>();
	if (includeSpecs && itemIds.length > 0) {
		const specsResult = await query<{ id: string; item_id: string; path: string; spec_type: SpecType; created_at: Date }>(
			'SELECT * FROM epic_specs WHERE project_id = $1 AND item_id = ANY($2) ORDER BY created_at ASC',
			[projectId, itemIds]
		);
		for (const s of specsResult.rows) {
			const existing = specsByItem.get(s.item_id) || [];
			existing.push({ id: s.id, path: s.path, type: s.spec_type, createdAt: s.created_at });
			specsByItem.set(s.item_id, existing);
		}
	}

	return result.rows.map((row) => ({
		...transformItem(row),
		childStats: {
			total: parseInt(row.child_count, 10),
			done: parseInt(row.done_count, 10),
			inProgress: parseInt(row.in_progress_count, 10),
			blocked: parseInt(row.blocked_count, 10),
		},
		children: (childrenByParent.get(row.id) || []).map(summarizeItem),
		progressNotes: notesByItem.get(row.id) || [],
		specs: specsByItem.get(row.id) || [],
	}));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** Create an item. Top-level when parentId is null/omitted, or a child under parentId. */
export async function createItem(projectId: string, data: CreateItemInput): Promise<ItemResponse> {
	const parentId = data.parentId ?? null;

	// Rank within the sibling group (project for top-level, parent for children).
	const rankResult = parentId
		? await query<{ max: number }>('SELECT COALESCE(MAX(rank), 0) as max FROM items WHERE parent_id = $1', [parentId])
		: await query<{ max: number }>('SELECT COALESCE(MAX(rank), 0) as max FROM items WHERE project_id = $1 AND parent_id IS NULL', [projectId]);
	const rank = data.rank ?? (rankResult.rows[0]?.max ?? 0) + 1;

	const initialStatus = data.status || 'ready';
	const subStatus = deriveSubStatusFromStatus(initialStatus);

	const result = await query<Item>(
		`INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, creator, rank)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING *`,
		[projectId, parentId, data.type || 'epic', data.title, data.description || null, initialStatus, subStatus, data.creator || null, rank]
	);

	return { ...transformItem(result.rows[0]!), childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } };
}

/** Bulk-create child items under a parent (used for task breakdowns). */
export async function createItems(
	projectId: string,
	parentId: string,
	items: Array<{ title: string; description?: string; type?: ItemType }>
): Promise<ItemResponse[]> {
	const rankResult = await query<{ max: number }>('SELECT COALESCE(MAX(rank), 0) as max FROM items WHERE parent_id = $1', [parentId]);
	let nextRank = (rankResult.rows[0]?.max ?? 0) + 1;

	const created: ItemResponse[] = [];
	for (const data of items) {
		const result = await query<Item>(
			`INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, rank)
			 VALUES ($1, $2, $3, $4, $5, 'ready', 'not_started', $6)
			 RETURNING *`,
			[projectId, parentId, data.type || 'task', data.title, data.description || null, nextRank++]
		);
		created.push({ ...transformItem(result.rows[0]!), childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } });
	}
	return created;
}

/** Update an item. Setting subStatus auto-derives board status at key transitions. */
export async function updateItem(projectId: string, itemId: string, data: UpdateItemInput): Promise<ItemResponse | null> {
	if (data.subStatus !== undefined && data.status === undefined) {
		const derived = deriveStatusFromSubStatus(data.subStatus);
		if (derived) data.status = derived;
	}

	const updates: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	const set = (col: string, val: unknown): void => { updates.push(`${col} = $${i++}`); values.push(val); };

	if (data.title !== undefined) set('title', data.title);
	if (data.description !== undefined) set('description', data.description);
	if (data.status !== undefined) set('status', data.status);
	if (data.subStatus !== undefined) set('sub_status', data.subStatus);
	if (data.rank !== undefined) set('rank', data.rank);
	if (data.prUrl !== undefined) set('pr_url', data.prUrl);
	if (data.branchName !== undefined) set('branch_name', data.branchName);
	if (data.note !== undefined) set('note', data.note);
	if (data.notes !== undefined) {
		// Append a timestamped entry to the running notes log.
		const entry = `[${new Date().toISOString().split('T')[0]}] ${data.notes}`;
		updates.push(`notes = CASE WHEN notes IS NULL THEN $${i} ELSE notes || E'\\n' || $${i} END`);
		values.push(entry);
		i++;
	}

	if (updates.length === 0) {
		const found = await getItems({ projectId, itemId });
		return found[0] ?? null;
	}

	updates.push('updated_at = NOW()');
	values.push(itemId, projectId);
	const result = await query<Item>(
		`UPDATE items SET ${updates.join(', ')} WHERE id = $${i++} AND project_id = $${i} RETURNING *`,
		values
	);
	if (result.rows.length === 0) return null;

	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}

/**
 * Move an item to a new parent (reparent), or to top-level when newParentId is null
 * (promote to standalone). Re-ranks at the bottom of the destination sibling group.
 */
export async function moveItem(projectId: string, itemId: string, newParentId: string | null): Promise<ItemResponse | null> {
	const rankResult = newParentId
		? await query<{ max: number }>('SELECT COALESCE(MAX(rank), 0) as max FROM items WHERE parent_id = $1', [newParentId])
		: await query<{ max: number }>('SELECT COALESCE(MAX(rank), 0) as max FROM items WHERE project_id = $1 AND parent_id IS NULL', [projectId]);
	const rank = (rankResult.rows[0]?.max ?? 0) + 1;

	const result = await query<Item>(
		`UPDATE items SET parent_id = $1, rank = $2, updated_at = NOW() WHERE id = $3 AND project_id = $4 RETURNING *`,
		[newParentId, rank, itemId, projectId]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}

/** Delete an item (its children cascade via the parent_id FK). */
export async function deleteItem(projectId: string, itemId: string): Promise<boolean> {
	const result = await query('DELETE FROM items WHERE id = $1 AND project_id = $2', [itemId, projectId]);
	return (result.rowCount ?? 0) > 0;
}

// ── Status lifecycle (applies to any item) ──────────────────────────────────

/** Start an item: in_progress, and bump its parent to in_progress if it was ready. */
export async function startItem(projectId: string, itemId: string): Promise<ItemResponse | null> {
	const result = await query<Item>(
		`UPDATE items SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND project_id = $2 RETURNING *`,
		[itemId, projectId]
	);
	if (result.rows.length === 0) return null;
	const item = result.rows[0]!;
	if (item.parent_id) {
		await query(`UPDATE items SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND status = 'ready'`, [item.parent_id]);
	}
	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}

/** Complete an item, optionally recording an outcome note. */
export async function completeItem(projectId: string, itemId: string, note?: string): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'done', note = COALESCE($3, note), updated_at = NOW() WHERE id = $1 AND project_id = $2 RETURNING id`,
		[itemId, projectId, note ?? null]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}

/** Block an item with a required reason note. */
export async function blockItem(projectId: string, itemId: string, note: string): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'blocked', note = $3, updated_at = NOW() WHERE id = $1 AND project_id = $2 RETURNING id`,
		[itemId, projectId, note]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}

/** Unblock an item back to ready. */
export async function unblockItem(projectId: string, itemId: string): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'ready', updated_at = NOW() WHERE id = $1 AND project_id = $2 RETURNING id`,
		[itemId, projectId]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemId });
	return found[0] ?? null;
}
