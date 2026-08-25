/**
 * Item service — unified business logic for all work items (epic/task/bug).
 *
 * An item has an optional `parent_id`: top-level items (parent_id NULL) are epics,
 * standalone tasks, or standalone bugs; nested items are an item's children. Children
 * are themselves items, so the same operations apply at every level.
 */

import { formatItemKey } from '@specboard/core/identifiers';
import { query } from '../index.ts';
import type { Item, ItemType, ItemStatus, SubStatus, SpecType } from '../types.ts';

/** An items row joined to its project's key, so responses can carry the item key. */
type ItemRow = Item & { project_key: string };

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
	/** Per-project sequence number. */
	number: number;
	/** The item's address, `<project key>-<number>` (e.g. SB-345). */
	key: string;
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
	/** Per-project sequence number. */
	number: number;
	/** The item's address, `<project key>-<number>` (e.g. SB-345). */
	key: string;
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
	/** Number of the item to nest under, or null/omitted for a top-level item. */
	parentNumber?: number | null;
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
	/** Fetch exactly this item (by its per-project number) instead of listing. */
	itemNumber?: number;
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

function transformItem(item: ItemRow): Omit<ItemResponse, 'childStats'> {
	return {
		id: item.id,
		number: item.number!,
		key: formatItemKey(item.project_key, item.number!),
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

function summarizeItem(item: Item, projectKey: string): ItemSummary {
	return {
		id: item.id,
		number: item.number!,
		key: formatItemKey(projectKey, item.number!),
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

/** Verify an item with this number exists in the project. */
export async function verifyItemOwnership(projectId: string, itemNumber: number): Promise<boolean> {
	const result = await query(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	return result.rows.length > 0;
}

/** Resolve an item's number to its internal id, or null when the project has no such item. */
export async function resolveItemNumber(projectId: string, itemNumber: number): Promise<string | null> {
	const result = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	return result.rows[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

type ItemWithCounts = ItemRow & {
	child_count: string;
	done_count: string;
	in_progress_count: string;
	blocked_count: string;
};

/**
 * Query top-level items (parent_id IS NULL) with child stats, or a single item by its
 * per-project number. Optionally include each item's children, progress notes, and specs.
 */
export async function getItems(params: GetItemsParams): Promise<ItemWithDetails[]> {
	const { projectId, itemNumber, status, type, search, includeChildren, includeNotes, includeSpecs, limit = 25 } = params;

	// The project join supplies the key that every item key is built from.
	let sql = `
		SELECT i.*, p.key as project_key,
			COUNT(c.id) as child_count,
			COUNT(c.id) FILTER (WHERE c.status = 'done') as done_count,
			COUNT(c.id) FILTER (WHERE c.status = 'in_progress') as in_progress_count,
			COUNT(c.id) FILTER (WHERE c.status = 'blocked') as blocked_count
		FROM items i
		JOIN projects p ON p.id = i.project_id
		LEFT JOIN items c ON c.parent_id = i.id
		WHERE i.project_id = $1
	`;
	const queryParams: unknown[] = [projectId];
	let paramIndex = 2;

	if (itemNumber !== undefined) {
		sql += ` AND i.number = $${paramIndex}`;
		queryParams.push(itemNumber);
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

	sql += ` GROUP BY i.id, p.key ORDER BY i.rank ASC, i.created_at ASC, i.id ASC`;
	if (itemNumber === undefined) {
		sql += ` LIMIT $${paramIndex}`;
		queryParams.push(limit);
	}

	const result = await query<ItemWithCounts>(sql, queryParams);
	const itemIds = result.rows.map((r) => r.id);

	const childrenByParent = new Map<string, Item[]>();
	if (includeChildren && itemIds.length > 0) {
		const childResult = await query<Item>(
			'SELECT * FROM items WHERE parent_id = ANY($1) ORDER BY rank ASC, created_at ASC, id ASC',
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
		children: (childrenByParent.get(row.id) || []).map((child) => summarizeItem(child, row.project_key)),
		progressNotes: notesByItem.get(row.id) || [],
		specs: specsByItem.get(row.id) || [],
	}));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an item. Top-level when parentNumber is null/omitted, or a child under it.
 *
 * The item's number comes from the project's allocator, bumped in the same statement
 * as the insert so concurrent creates can't be handed the same number.
 */
export async function createItem(projectId: string, data: CreateItemInput): Promise<ItemResponse> {
	const parentNumber = data.parentNumber ?? null;

	const initialStatus = data.status || 'ready';
	const subStatus = deriveSubStatusFromStatus(initialStatus);

	// Rank within the sibling group (project for top-level, parent for children), computed
	// inside the INSERT to avoid a read-modify-write race. Concurrent inserts can still
	// collide on a rank; the created_at/id ORDER BY tiebreakers keep ordering stable anyway.
	const values: unknown[] = [projectId, parentNumber, data.type || 'epic', data.title, data.description || null, initialStatus, subStatus, data.creator || null];
	let rankSql: string;
	if (data.rank !== undefined) {
		values.push(data.rank);
		rankSql = `$${values.length}`;
	} else if (parentNumber !== null) {
		rankSql = '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))';
	} else {
		rankSql = '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $1 AND parent_id IS NULL)';
	}

	const result = await query<ItemRow>(
		`WITH parent AS (
			SELECT id FROM items WHERE project_id = $1 AND number = $2
		), allocated AS (
			UPDATE projects SET item_seq = item_seq + 1 WHERE id = $1 RETURNING id, key, item_seq
		), inserted AS (
			INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, creator, rank, number)
			SELECT $1, (SELECT id FROM parent), $3, $4, $5, $6, $7, $8, ${rankSql}, a.item_seq
			FROM allocated a
			RETURNING *
		)
		SELECT inserted.*, (SELECT key FROM allocated) AS project_key FROM inserted`,
		values
	);

	return { ...transformItem(result.rows[0]!), childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } };
}

/** Bulk-create child items under a parent (used for task breakdowns). */
export async function createItems(
	projectId: string,
	parentNumber: number,
	items: Array<{ title: string; description?: string; type?: ItemType }>
): Promise<ItemResponse[]> {
	if (items.length === 0) return [];

	// Single statement: one MAX(rank) snapshot plus each row's ordinal keeps ranks
	// sequential within the batch. The subquery reads the pre-statement snapshot, so
	// the race posture matches createItem's inline subquery. Item numbers come from
	// one bump of the project allocator, split across the batch by the same ordinal.
	const result = await query<ItemRow>(
		`WITH parent AS (
			SELECT id FROM items WHERE project_id = $1 AND number = $2
		), allocated AS (
			UPDATE projects SET item_seq = item_seq + $6 WHERE id = $1
			RETURNING key, item_seq - $6 AS base
		), inserted AS (
			INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, rank, number)
			SELECT $1, (SELECT id FROM parent), v.type, v.title, v.description, 'ready', 'not_started',
			       (SELECT COALESCE(MAX(rank), 0) FROM items WHERE parent_id = (SELECT id FROM parent)) + row_number() OVER (ORDER BY v.ord),
			       a.base + row_number() OVER (ORDER BY v.ord)
			FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS v(type, title, description, ord)
			CROSS JOIN allocated a
			RETURNING *
		)
		SELECT inserted.*, (SELECT key FROM allocated) AS project_key FROM inserted`,
		[projectId, parentNumber, items.map((d) => d.type || 'task'), items.map((d) => d.title), items.map((d) => d.description || null), items.length]
	);

	return result.rows
		.sort((a, b) => a.rank - b.rank)
		.map((row) => ({ ...transformItem(row), childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } }));
}

/** Update an item. Setting subStatus auto-derives board status at key transitions. */
export async function updateItem(projectId: string, itemNumber: number, data: UpdateItemInput): Promise<ItemResponse | null> {
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
		const found = await getItems({ projectId, itemNumber });
		return found[0] ?? null;
	}

	updates.push('updated_at = NOW()');
	values.push(itemNumber, projectId);
	const result = await query(
		`UPDATE items SET ${updates.join(', ')} WHERE number = $${i++} AND project_id = $${i} RETURNING id`,
		values
	);
	if (result.rows.length === 0) return null;

	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}

/**
 * True if making `newParentNumber` the parent of `itemNumber` would create a cycle —
 * i.e. the new parent is the item itself or one of its descendants. Walks down from
 * the item.
 */
export async function wouldCreateCycle(projectId: string, itemNumber: number, newParentNumber: number): Promise<boolean> {
	const result = await query(
		`WITH RECURSIVE descendants AS (
			SELECT id FROM items WHERE number = $1 AND project_id = $2
			UNION ALL
			SELECT i.id FROM items i JOIN descendants d ON i.parent_id = d.id
		)
		SELECT 1 FROM descendants d
		JOIN items i ON i.id = d.id
		WHERE i.number = $3 AND i.project_id = $2 LIMIT 1`,
		[itemNumber, projectId, newParentNumber]
	);
	return result.rows.length > 0;
}

/**
 * Move an item to a new parent (reparent), or to top-level when newParentId is null
 * (promote to standalone). Re-ranks at the bottom of the destination sibling group.
 */
export async function moveItem(projectId: string, itemNumber: number, newParentNumber: number | null): Promise<ItemResponse | null> {
	const rankSql = newParentNumber !== null
		? '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))'
		: '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $3 AND parent_id IS NULL)';
	const result = await query(
		`WITH parent AS (
			SELECT id FROM items WHERE project_id = $3 AND number = $1
		)
		UPDATE items SET parent_id = (SELECT id FROM parent), rank = ${rankSql}, updated_at = NOW()
		WHERE number = $2 AND project_id = $3 RETURNING id`,
		[newParentNumber, itemNumber, projectId]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}

/** Delete an item (its children cascade via the parent_id FK). */
export async function deleteItem(projectId: string, itemNumber: number): Promise<boolean> {
	const result = await query('DELETE FROM items WHERE number = $1 AND project_id = $2', [itemNumber, projectId]);
	return (result.rowCount ?? 0) > 0;
}

// ── Status lifecycle (applies to any item) ──────────────────────────────────

/** Start an item: in_progress, and bump its parent to in_progress if it was ready. */
export async function startItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const result = await query<{ parent_id: string | null }>(
		`UPDATE items SET status = 'in_progress', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING parent_id`,
		[itemNumber, projectId]
	);
	if (result.rows.length === 0) return null;
	const parentId = result.rows[0]!.parent_id;
	if (parentId) {
		await query(`UPDATE items SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND status = 'ready'`, [parentId]);
	}
	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}

/** Complete an item, optionally recording an outcome note. */
export async function completeItem(projectId: string, itemNumber: number, note?: string): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'done', note = COALESCE($3, note), updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING id`,
		[itemNumber, projectId, note ?? null]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}

/** Block an item with a required reason note. */
export async function blockItem(projectId: string, itemNumber: number, note: string): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'blocked', note = $3, updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING id`,
		[itemNumber, projectId, note]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}

/** Unblock an item back to ready. */
export async function unblockItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const result = await query(
		`UPDATE items SET status = 'ready', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING id`,
		[itemNumber, projectId]
	);
	if (result.rows.length === 0) return null;
	const found = await getItems({ projectId, itemNumber });
	return found[0] ?? null;
}
