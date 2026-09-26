/**
 * Item service — unified business logic for all work items (epic/task/bug).
 *
 * An item has an optional `parent_id`: top-level items (parent_id NULL) are epics,
 * standalone tasks, or standalone bugs; nested items are an item's children. Children
 * are themselves items, so the same operations apply at every level.
 */

import type pg from 'pg';
import { formatItemKey, parseItemKey } from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import type { Item, ItemType, ItemStatus, SubStatus, StatusSource, SpecType, ItemOrigin, ChecklistEntry } from '../types.ts';
import { bumpItem, clearBlockersForCompletion, listOpenBlockersByItems, type BlockerSummary } from './blockers.ts';
import { listNotesByItems, type ItemNoteSummary } from './notes.ts';
import { endWorkers, listActiveWorkersByItems, type WorkerSummary } from './workers.ts';

/**
 * An items row joined to its project's key and its parent's number and title, so
 * responses can carry both its own key and its parent's key and title.
 */
interface ItemRow extends Item {
	project_key: string;
	parent_number: number | null;
	parent_title: string | null;
}

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
	/** Derived: status is 'blocked' OR an open blocker row exists. */
	blocked: boolean;
	description: string | null;
}

export interface ItemResponse {
	id: string;
	/** Per-project sequence number. */
	number: number;
	/** The item's address, `<project key>-<number>` (e.g. SB-345). */
	key: string;
	parentId: string | null;
	/** Key of the parent item, or null for a top-level item. The form every write accepts. */
	parentKey: string | null;
	/** Title of the parent item, or null for a top-level item. Read-only; joined for display. */
	parentTitle: string | null;
	type: ItemType;
	title: string;
	description: string | null;
	status: ItemStatus;
	subStatus: SubStatus | null;
	/** Derived: status is 'blocked' OR an open blocker row exists. */
	blocked: boolean;
	/** Immutable creation provenance; null predates tracking. */
	origin: ItemOrigin | null;
	assignee: string | null;
	rank: number;
	dueDate: Date | null;
	prUrl: string | null;
	branchName: string | null;
	createdAt: Date;
	updatedAt: Date;
	childStats: ChildStats;
}

export interface ItemWithChildren extends ItemResponse {
	children: ItemSummary[];
}

export interface ItemWithDetails extends ItemWithChildren {
	specs: SpecSummary[];
	/**
	 * Activity-log entries (newest first) / open blockers / active agent-session
	 * episodes / scratch todos. Present only when requested (includeNotes /
	 * includeBlockers / includeWorkers / includeChecklist) — deliberately absent
	 * otherwise, so a client model applying an update response doesn't wipe state
	 * the response simply didn't load, and so an agent that didn't ask for the log
	 * doesn't read `[]` as "no history". Absent means "not loaded"; `[]` means
	 * genuinely empty.
	 */
	notes?: ItemNoteSummary[];
	blockers?: BlockerSummary[];
	workers?: WorkerSummary[];
	checklist?: ChecklistEntry[];
}

/** A page of items plus how many rows matched before `limit` cut the page. */
export interface ItemList {
	items: ItemWithDetails[];
	total: number;
}

export interface CreateItemInput {
	title: string;
	type?: ItemType;
	/** Number of the item to nest under, or null/omitted for a top-level item. */
	parentNumber?: number | null;
	description?: string;
	status?: ItemStatus;
	/** Creation provenance; the actor is captured server-side by the caller. */
	origin: ItemOrigin;
	/** Number of the item being worked when this one was filed; snapshotted into origin. */
	discoveredFromNumber?: number;
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
}

/**
 * Raised when a parent number names no item in the project. The parent is resolved
 * inside the INSERT/UPDATE by subquery, which yields NULL for a miss — that would
 * silently produce a *top-level* item (at rank 1, colliding with the real top level)
 * instead of an error, so every write re-checks the outcome and throws this.
 */
export class ParentItemNotFoundError extends Error {
	readonly parentNumber: number;

	constructor(parentNumber: number) {
		super(`No item numbered ${parentNumber} in this project`);
		this.name = 'ParentItemNotFoundError';
		this.parentNumber = parentNumber;
	}
}

/**
 * Raised when a move would put an item under itself or one of its descendants.
 * moveItem enforces this inside the UPDATE rather than trusting a prior
 * wouldCreateCycle call: two concurrent moves that are each individually safe can
 * still close a loop between the check and the write, and a cycle detaches an
 * entire subtree from the board with no way back through the UI.
 */
export class ItemCycleError extends Error {
	constructor() {
		super('Cannot move an item under itself or one of its descendants');
		this.name = 'ItemCycleError';
	}
}

/** Raised when discoveredFromNumber names no item in the project. */
export class DiscoveredFromNotFoundError extends Error {
	readonly itemNumber: number;

	constructor(itemNumber: number) {
		super(`No item numbered ${itemNumber} in this project`);
		this.name = 'DiscoveredFromNotFoundError';
		this.itemNumber = itemNumber;
	}
}

export interface GetItemsParams {
	projectId: string;
	/** Fetch exactly this item (by its per-project number) instead of listing. */
	itemNumber?: number;
	status?: ItemStatus;
	type?: ItemType;
	search?: string;
	/** Drop items that are blocked (status 'blocked' or any open blocker row). */
	excludeBlocked?: boolean;
	includeChildren?: boolean;
	includeNotes?: boolean;
	includeSpecs?: boolean;
	includeBlockers?: boolean;
	includeWorkers?: boolean;
	includeChecklist?: boolean;
	/** Max rows in the page (lists only), clamped to [1, MAX_LIST_LIMIT]. The result's `total` counts past it. */
	limit?: number;
}

/** Upper bound on one list page. A client growing its window stops here. */
export const MAX_LIST_LIMIT = 5000;
const DEFAULT_LIST_LIMIT = 25;

/**
 * The page size a caller asked for, made safe for SQL: callers hand through
 * query strings and MCP args, so this is the one place that turns "0", -1,
 * "abc", or 10^9 into a limit Postgres will accept and the total can stand behind.
 */
function pageLimit(requested: number | undefined): number {
	const n = typeof requested === 'number' ? requested : Number.parseInt(String(requested), 10);
	if (!Number.isFinite(n)) return DEFAULT_LIST_LIMIT;
	return Math.min(Math.max(Math.trunc(n), 1), MAX_LIST_LIMIT);
}

/**
 * A search term as a literal ILIKE pattern. `%`, `_`, and the backslash escape itself
 * are wildcards to Postgres, so an unescaped `foo_bar` would also match `fooXbar`.
 * Backslash is LIKE's default escape character, so no ESCAPE clause is needed.
 */
function likeLiteral(term: string): string {
	return term.replace(/[\\%_]/g, '\\$&');
}

const BARE_NUMBER = /^[0-9]{1,9}$/;

/**
 * The key half of a search term, or null when the term doesn't name a key. A key is
 * matched exactly: as a substring, `SAM-42` would also match on `s`, `sam`, and `-`,
 * so every keystroke on the way to typing a key returns the whole project.
 * The full-key branch defers to `parseItemKey` for the canonical `SB-345` format
 * (2-10 char project key, 1-9 digit number) rather than a looser local regex.
 */
function keyTerm(term: string): { projectKey?: string; number: number } | null {
	const full = parseItemKey(term.toUpperCase());
	if (full) return { projectKey: full.projectKey, number: full.number };
	if (BARE_NUMBER.test(term)) return { number: Number(term) };
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function transformItem(item: ItemRow): Omit<ItemResponse, 'childStats' | 'blocked'> {
	return {
		id: item.id,
		number: item.number!,
		key: formatItemKey(item.project_key, item.number!),
		parentId: item.parent_id,
		parentKey: item.parent_number === null ? null : formatItemKey(item.project_key, item.parent_number),
		parentTitle: item.parent_title,
		type: item.type,
		title: item.title,
		description: item.description,
		status: item.status,
		subStatus: item.sub_status,
		origin: item.origin,
		assignee: item.assignee,
		rank: item.rank,
		dueDate: item.due_date,
		prUrl: item.pr_url,
		branchName: item.branch_name,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
	};
}

function summarizeItem(item: Item & { blocked?: boolean }, projectKey: string): ItemSummary {
	return {
		id: item.id,
		number: item.number!,
		key: formatItemKey(projectKey, item.number!),
		type: item.type,
		title: item.title,
		status: item.status,
		blocked: item.blocked ?? item.status === 'blocked',
		description: item.description,
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

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

type ItemWithCounts = ItemRow & {
	blocked: boolean;
	child_count: string;
	done_count: string;
	in_progress_count: string;
	blocked_count: string;
	total_count: string;
};

/**
 * Query top-level items (parent_id IS NULL) with child stats, or a single item by its
 * per-project number. Optionally include each item's children, activity-log entries, specs,
 * blockers, and active workers.
 *
 * A search is the exception to top-level-only: it matches at any depth, so a child task
 * is findable without knowing which parent holds it. Matched children carry `parentKey`.
 * Every other filter applies to the matched item's own row, whatever its parent's state.
 *
 * `total` is the number of rows the filters matched, which can exceed the page when
 * `limit` cut it; it is what lets a client show a bounded window and know more exists.
 */
export async function getItems(params: GetItemsParams): Promise<ItemList> {
	const { projectId, itemNumber, status, type, excludeBlocked, includeChildren, includeNotes, includeSpecs, includeBlockers, includeWorkers, includeChecklist } = params;
	const search = params.search?.trim() || undefined;
	const limit = pageLimit(params.limit);

	// The project join supplies the key that every item key is built from.
	// open_blocks joins are one-to-one (DISTINCT), so they don't inflate the
	// child aggregate the way a direct join on item_blockers would.
	// COUNT(*) OVER() runs after GROUP BY and before LIMIT, so it counts matching
	// items, not child rows, and is not cut by the page.
	let sql = `
		WITH open_blocks AS (
			SELECT DISTINCT item_id FROM item_blockers WHERE project_id = $1 AND cleared_at IS NULL
		)
		SELECT i.*, p.key as project_key, parent.number as parent_number, parent.title as parent_title,
			(i.status = 'blocked' OR ob.item_id IS NOT NULL) as blocked,
			COUNT(*) OVER() as total_count,
			COUNT(c.id) as child_count,
			COUNT(c.id) FILTER (WHERE c.status = 'done') as done_count,
			COUNT(c.id) FILTER (WHERE c.status = 'in_progress') as in_progress_count,
			COUNT(c.id) FILTER (WHERE c.status = 'blocked' OR cob.item_id IS NOT NULL) as blocked_count
		FROM items i
		JOIN projects p ON p.id = i.project_id
		LEFT JOIN items parent ON parent.id = i.parent_id
		LEFT JOIN open_blocks ob ON ob.item_id = i.id
		LEFT JOIN items c ON c.parent_id = i.id
		LEFT JOIN open_blocks cob ON cob.item_id = c.id
		WHERE i.project_id = $1
	`;
	const queryParams: unknown[] = [projectId];
	let paramIndex = 2;

	if (itemNumber !== undefined) {
		sql += ` AND i.number = $${paramIndex}`;
		queryParams.push(itemNumber);
		paramIndex++;
	} else {
		// Lists show top-level items only; children surface via includeChildren. A search
		// lifts that: it spans every depth, because an item you can name is an item you
		// should be able to find without first knowing its parent.
		if (!search) sql += ` AND i.parent_id IS NULL`;
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
			// Text is matched as a substring, a key only in full: `SB-345` or a bare `345`.
			// Both are ORed with the text match, so a title that mentions a key still hits.
			sql += ` AND (i.title ILIKE $${paramIndex} OR i.description ILIKE $${paramIndex}`;
			queryParams.push(`%${likeLiteral(search)}%`);
			paramIndex++;
			const key = keyTerm(search);
			if (key?.projectKey !== undefined) {
				sql += ` OR (UPPER(p.key) = $${paramIndex} AND i.number = $${paramIndex + 1})`;
				queryParams.push(key.projectKey, key.number);
				paramIndex += 2;
			} else if (key) {
				sql += ` OR i.number = $${paramIndex}`;
				queryParams.push(key.number);
				paramIndex++;
			}
			sql += `)`;
		}
		if (excludeBlocked) {
			sql += ` AND NOT (i.status = 'blocked' OR ob.item_id IS NOT NULL)`;
		}
	}

	sql += ` GROUP BY i.id, p.key, parent.number, parent.title, ob.item_id ORDER BY i.rank ASC, i.created_at ASC, i.id ASC`;
	if (itemNumber === undefined) {
		sql += ` LIMIT $${paramIndex}`;
		queryParams.push(limit);
	}

	const result = await query<ItemWithCounts>(sql, queryParams);
	const itemIds = result.rows.map((r) => r.id);

	const childrenByParent = new Map<string, Array<Item & { blocked: boolean }>>();
	if (includeChildren && itemIds.length > 0) {
		const childResult = await query<Item & { blocked: boolean }>(
			`SELECT c.*, (c.status = 'blocked' OR ob.item_id IS NOT NULL) as blocked
			 FROM items c
			 LEFT JOIN (SELECT DISTINCT item_id FROM item_blockers WHERE project_id = $2 AND cleared_at IS NULL) ob ON ob.item_id = c.id
			 WHERE c.parent_id = ANY($1) ORDER BY c.rank ASC, c.created_at ASC, c.id ASC`,
			[itemIds, projectId]
		);
		for (const child of childResult.rows) {
			if (!child.parent_id) continue;
			const existing = childrenByParent.get(child.parent_id) || [];
			existing.push(child);
			childrenByParent.set(child.parent_id, existing);
		}
	}

	const notesByItem = includeNotes && itemIds.length > 0
		? await listNotesByItems(itemIds)
		: undefined;

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

	const blockersByItem = includeBlockers && itemIds.length > 0
		? await listOpenBlockersByItems(projectId, itemIds)
		: undefined;
	const workersByItem = includeWorkers && itemIds.length > 0
		? await listActiveWorkersByItems(itemIds)
		: undefined;

	// An empty page means nothing matched: with no offset there is no row to carry the count.
	const total = result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0;

	const items = result.rows.map((row) => ({
		...transformItem(row),
		blocked: row.blocked,
		childStats: {
			total: parseInt(row.child_count, 10),
			done: parseInt(row.done_count, 10),
			inProgress: parseInt(row.in_progress_count, 10),
			blocked: parseInt(row.blocked_count, 10),
		},
		children: (childrenByParent.get(row.id) || []).map((child) => summarizeItem(child, row.project_key)),
		specs: specsByItem.get(row.id) || [],
		...(notesByItem ? { notes: notesByItem.get(row.id) || [] } : {}),
		...(blockersByItem ? { blockers: blockersByItem.get(row.id) || [] } : {}),
		...(workersByItem ? { workers: workersByItem.get(row.id) || [] } : {}),
		...(includeChecklist ? { checklist: row.checklist } : {}),
	}));

	return { items, total };
}

/** One item by its per-project number, as the write paths return it. */
async function getItemByNumber(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const { items } = await getItems({ projectId, itemNumber });
	return items[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** Child statuses that mean work on the parent has begun. Blocked is a hold, not progress. */
const STARTED_CHILD_STATUSES: ItemStatus[] = ['in_progress', 'in_review', 'done'];

/** Sub-statuses by which an item claims in_progress for itself, whatever its children are doing. */
const ACTIVE_SUB_STATUSES: SubStatus[] = ['scoping', 'in_development', 'needs_input', 'paused', 'pr_open'];

/**
 * Recompute an item's status from its current children, then its parent's, and so on
 * up to the root. Called with the parent after every write that can change a child's
 * status or the child set, so the rollup reverses as readily as it advances, and with
 * the item itself after a sub_status write, since its own sub_status is an input too.
 * A level that holds still doesn't end the walk: an explicit in_progress parent can sit
 * under a ready grandparent, and only a recompute of the grandparent notices.
 *
 * It only moves an item between ready and in_progress: ready rolls up when any child
 * has started; in_progress rolls back when none has, unless the item's
 * own sub_status says it is active or nobody but the rollup or a sub_status put it in
 * progress (status_source 'rollup' or 'sub_status'). An explicit in_progress (a drag, a
 * start) is the caller's call and stays. Blocked, in_review, and done are explicit states
 * and are never touched. A rollback ends worker episodes like any other transition out
 * of in_progress.
 *
 * `touch` says the first level's children changed (membership or a child's status), so
 * its updated_at moves even when its status holds: list reads carry per-status child
 * counts, and clients only reapply a polled row whose updated_at moved. Each level up
 * is touched only when the level below it changed status.
 *
 * Each level is its own transaction that locks the row before recomputing, so rollups
 * of one item run one at a time. Every rollup starts after the write that triggered it
 * has committed, and the recompute is a separate statement from the lock so its
 * READ COMMITTED snapshot is taken after the lock is granted; the last rollup to run
 * therefore sees every child write that preceded it. Committing each level before
 * locking the next means a rollup never holds two item locks, so walks can't deadlock.
 */
async function rollUpStatus(fromId: string | null, touch: boolean): Promise<void> {
	let id = fromId;
	let touchLevel = touch;
	while (id) {
		const levelId = id;
		const levelTouch = touchLevel;
		const step = await transaction((client) => rollUpLevel(client, levelId, levelTouch));
		id = step.parentId;
		touchLevel = step.changed;
	}
}

interface RollUpStep {
	/** The next item up, or null at the root (or when the item is gone). */
	parentId: string | null;
	/** Whether this level's status changed, which changes its parent's child counts. */
	changed: boolean;
}

/** One level of the rollup: lock, recompute, and touch the row if asked and it held still. */
async function rollUpLevel(client: pg.PoolClient, itemId: string, touch: boolean): Promise<RollUpStep> {
	// NO KEY UPDATE, not UPDATE: it still excludes other rollups but doesn't block the
	// FK's KEY SHARE lock, so children can be created under or moved into this item meanwhile.
	const locked = await client.query<{ parent_id: string | null }>(
		'SELECT parent_id FROM items WHERE id = $1 FOR NO KEY UPDATE',
		[itemId]
	);
	const lockedRow = locked.rows[0];
	if (!lockedRow) return { parentId: null, changed: false };
	const result = await client.query<{ project_id: string; number: number; status: ItemStatus }>(
		`WITH children AS (
			SELECT EXISTS (SELECT 1 FROM items WHERE parent_id = $1 AND status = ANY($2::text[])) AS started
		)
		UPDATE items
		SET status = CASE WHEN (SELECT started FROM children) THEN 'in_progress' ELSE 'ready' END,
			status_source = 'rollup', updated_at = NOW()
		WHERE id = $1 AND (
			(status = 'ready' AND (SELECT started FROM children))
			OR (status = 'in_progress' AND NOT (SELECT started FROM children)
				AND status_source IN ('rollup', 'sub_status')
				AND (sub_status IS NULL OR sub_status <> ALL($3::text[])))
		)
		RETURNING project_id, number, status`,
		[itemId, STARTED_CHILD_STATUSES, ACTIVE_SUB_STATUSES]
	);
	const row = result.rows[0];
	if (!row) {
		if (touch) await bumpItem(client, itemId);
		return { parentId: lockedRow.parent_id, changed: false };
	}
	if (row.status !== 'in_progress') await endWorkers(row.project_id, row.number, client);
	return { parentId: lockedRow.parent_id, changed: true };
}

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
	const origin = await resolveOrigin(projectId, data.origin, data.discoveredFromNumber);

	// Rank within the sibling group (project for top-level, parent for children), computed
	// inside the INSERT to avoid a read-modify-write race. Concurrent inserts can still
	// collide on a rank; the created_at/id ORDER BY tiebreakers keep ordering stable anyway.
	const values: unknown[] = [projectId, parentNumber, data.type || 'epic', data.title, data.description || null, initialStatus, subStatus, JSON.stringify(origin)];
	let rankSql: string;
	if (data.rank !== undefined) {
		values.push(data.rank);
		rankSql = `$${values.length}`;
	} else if (parentNumber !== null) {
		rankSql = '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))';
	} else {
		rankSql = '(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $1 AND parent_id IS NULL)';
	}

	// The allocator's UPDATE is gated on the parent resolving, so a parentNumber that
	// names nothing produces zero rows *and writes nothing* — no phantom top-level item,
	// no consumed number. Checking the returned row instead would be too late: this runs
	// in autocommit, so the insert would already be durable by the time JS saw it.
	const result = await query<ItemRow>(
		`WITH parent AS (
			SELECT id, title FROM items WHERE project_id = $1 AND number = $2
		), allocated AS (
			UPDATE projects SET item_seq = item_seq + 1
			WHERE id = $1 AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM parent))
			RETURNING id, key, item_seq
		), inserted AS (
			INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, origin, rank, number)
			SELECT $1, (SELECT id FROM parent), $3, $4, $5, $6, $7, $8::jsonb, ${rankSql}, a.item_seq
			FROM allocated a
			RETURNING *
		)
		SELECT inserted.*, (SELECT key FROM allocated) AS project_key,
			$2::int AS parent_number, (SELECT title FROM parent) AS parent_title
		FROM inserted`,
		values
	);

	const row = result.rows[0];
	if (!row) await throwCreateFailure(projectId, parentNumber);
	await rollUpStatus(row!.parent_id, true);
	return { ...transformItem(row!), blocked: row!.status === 'blocked', childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } };
}

/**
 * Snapshot discoveredFromNumber into the origin as { itemId, itemKey }. The
 * lookup runs before the insert (autocommit), so a concurrent delete of the
 * source between the two is a harmless stale snapshot — which is what a
 * snapshot is for.
 */
async function resolveOrigin(projectId: string, origin: ItemOrigin, discoveredFromNumber?: number): Promise<ItemOrigin> {
	if (discoveredFromNumber == null) return origin;
	const result = await query<{ id: string; key: string }>(
		`SELECT i.id, p.key FROM items i JOIN projects p ON p.id = i.project_id
		 WHERE i.project_id = $1 AND i.number = $2`,
		[projectId, discoveredFromNumber]
	);
	const row = result.rows[0];
	if (!row) throw new DiscoveredFromNotFoundError(discoveredFromNumber);
	return { ...origin, discoveredFrom: { itemId: row.id, itemKey: formatItemKey(row.key, discoveredFromNumber) } };
}

/**
 * Diagnose a write that matched no rows. Both causes are rare, so one extra query on
 * the failure path is cheaper than carrying the distinction through the main statement.
 */
async function throwCreateFailure(projectId: string, parentNumber: number | null): Promise<never> {
	if (parentNumber !== null && !(await verifyItemOwnership(projectId, parentNumber))) {
		throw new ParentItemNotFoundError(parentNumber);
	}
	throw new Error('Item creation affected no rows — the project no longer exists');
}

/** Bulk-create child items under a parent (used for task breakdowns). One origin is shared by the batch. */
export async function createItems(
	projectId: string,
	parentNumber: number,
	items: Array<{ title: string; description?: string; type?: ItemType }>,
	origin: ItemOrigin,
	discoveredFromNumber?: number
): Promise<ItemResponse[]> {
	if (items.length === 0) return [];
	const resolvedOrigin = await resolveOrigin(projectId, origin, discoveredFromNumber);

	// Single statement: one MAX(rank) snapshot plus each row's ordinal keeps ranks
	// sequential within the batch. The subquery reads the pre-statement snapshot, so
	// the race posture matches createItem's inline subquery. Item numbers come from
	// one bump of the project allocator, split across the batch by the same ordinal.
	const result = await query<ItemRow>(
		`WITH parent AS (
			SELECT id, title FROM items WHERE project_id = $1 AND number = $2
		), allocated AS (
			UPDATE projects SET item_seq = item_seq + $6
			WHERE id = $1 AND EXISTS (SELECT 1 FROM parent)
			RETURNING key, item_seq - $6 AS base
		), inserted AS (
			INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, origin, rank, number)
			SELECT $1, (SELECT id FROM parent), v.type, v.title, v.description, 'ready', 'not_started', $7::jsonb,
			       (SELECT COALESCE(MAX(rank), 0) FROM items WHERE parent_id = (SELECT id FROM parent)) + row_number() OVER (ORDER BY v.ord),
			       a.base + row_number() OVER (ORDER BY v.ord)
			FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS v(type, title, description, ord)
			CROSS JOIN allocated a
			RETURNING *
		)
		SELECT inserted.*, (SELECT key FROM allocated) AS project_key,
			$2::int AS parent_number, (SELECT title FROM parent) AS parent_title
		FROM inserted`,
		[projectId, parentNumber, items.map((d) => d.type || 'task'), items.map((d) => d.title), items.map((d) => d.description || null), items.length, JSON.stringify(resolvedOrigin)]
	);

	if (result.rows.length === 0) await throwCreateFailure(projectId, parentNumber);
	await rollUpStatus(result.rows[0]!.parent_id, true);

	return result.rows
		.sort((a, b) => a.rank - b.rank)
		.map((row) => ({ ...transformItem(row), blocked: false, childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 } }));
}

interface UpdatedRow {
	id: string;
	parent_id: string | null;
	status_changed: boolean;
}

/**
 * Update an item. Setting subStatus auto-derives board status at key transitions;
 * a status the caller names wins over the derived one.
 *
 * A status write records its source only when it moves the status. The web client
 * saves by PUTting the whole model, so every title edit or in-column reorder restates
 * the current status; counting that as an explicit write would silently pin a
 * rollup-promoted parent in progress. A status equal to what the sub_status derives is
 * recorded as the sub_status's, since the drawer mirrors the derive client-side and
 * sends both.
 */
export async function updateItem(projectId: string, itemNumber: number, data: UpdateItemInput): Promise<ItemResponse | null> {
	const derived = data.subStatus === undefined ? undefined : deriveStatusFromSubStatus(data.subStatus);
	const status = data.status ?? derived;

	const updates: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	const set = (col: string, val: unknown): void => { updates.push(`${col} = $${i++}`); values.push(val); };

	if (data.title !== undefined) set('title', data.title);
	if (data.description !== undefined) set('description', data.description);
	if (status !== undefined) {
		const source: StatusSource = status === derived ? 'sub_status' : 'explicit';
		// SET expressions read the row as it was, so `status` here is the old value.
		updates.push(`status_source = CASE WHEN status IS DISTINCT FROM $${i} THEN $${i + 1} ELSE status_source END`);
		values.push(status, source);
		i += 2;
		set('status', status);
	}
	if (data.subStatus !== undefined) set('sub_status', data.subStatus);
	if (data.rank !== undefined) set('rank', data.rank);
	if (data.prUrl !== undefined) set('pr_url', data.prUrl);
	if (data.branchName !== undefined) set('branch_name', data.branchName);

	if (updates.length === 0) {
		return getItemByNumber(projectId, itemNumber);
	}

	updates.push('updated_at = NOW()');
	values.push(itemNumber, projectId);
	// The parent is touched only when the status actually moves, not on every restating
	// PUT, so the write reports whether it did. The locking sub-select reads the row as
	// it stands once any concurrent write has committed; a plain one would report against
	// the statement's older snapshot.
	const sql = `UPDATE items SET ${updates.join(', ')}
		FROM (SELECT id AS previous_id, status AS previous_status FROM items
			WHERE number = $${i++} AND project_id = $${i} FOR NO KEY UPDATE) previous
		WHERE items.id = previous.previous_id
		RETURNING id, parent_id, status IS DISTINCT FROM previous.previous_status AS status_changed`;

	// Reaching done (directly or via subStatus 'complete') auto-clears blockers —
	// dependents' and the item's own — in the same transaction as the status write.
	let updated: UpdatedRow | undefined;
	if (status === 'done') {
		updated = await transaction(async (client) => {
			const result = await client.query<UpdatedRow>(sql, values);
			const row = result.rows[0];
			if (row) await clearBlockersForCompletion(client, row.id);
			return row;
		});
	} else {
		const result = await query<UpdatedRow>(sql, values);
		updated = result.rows[0];
	}
	if (!updated) return null;
	const { id, parent_id: parentId, status_changed: statusChanged } = updated;

	// Any status transition out of in_progress ends worker episodes — the item
	// is no longer being worked, whichever surface moved it.
	if (status !== undefined && status !== 'in_progress') await endWorkers(projectId, itemNumber);
	if (data.subStatus !== undefined) {
		// The sub_status may have been the only thing holding the item in_progress over
		// children that haven't started, so the walk starts at the item itself. A status
		// sent alongside it doesn't skip this: the web client always sends one, and an
		// explicit status is safe from the rollup. The parent hears of the item's status
		// moving whether the write or the recompute moved it.
		const own = await transaction((client) => rollUpLevel(client, id, false));
		await rollUpStatus(own.parentId, own.changed || statusChanged);
	} else if (status !== undefined) {
		await rollUpStatus(parentId, statusChanged);
	}

	return getItemByNumber(projectId, itemNumber);
}

/**
 * True if making `newParentNumber` the parent of `itemNumber` would create a cycle —
 * i.e. the new parent is the item itself or one of its descendants. Walks down from
 * the item.
 */
export async function wouldCreateCycle(projectId: string, itemNumber: number, newParentNumber: number): Promise<boolean> {
	const result = await query(
		// UNION, not UNION ALL: it deduplicates against rows already produced, so if the
		// tree is *already* cyclic the walk terminates instead of spinning forever and
		// pinning a pool connection.
		`WITH RECURSIVE descendants AS (
			SELECT id FROM items WHERE number = $1 AND project_id = $2
			UNION
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
	const result = await query<{ id: string; parent_id: string | null; previous_parent_id: string | null }>(
		`WITH RECURSIVE parent AS (
			SELECT id FROM items WHERE project_id = $3 AND number = $1
		), previous AS (
			SELECT parent_id FROM items WHERE number = $2 AND project_id = $3
		), descendants AS (
			SELECT id FROM items WHERE number = $2 AND project_id = $3
			UNION
			SELECT i.id FROM items i JOIN descendants d ON i.parent_id = d.id
		)
		UPDATE items SET parent_id = (SELECT id FROM parent), rank = ${rankSql}, updated_at = NOW()
		WHERE number = $2 AND project_id = $3
		  AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM parent))
		  AND ($1::int IS NULL OR NOT EXISTS (
			SELECT 1 FROM descendants d WHERE d.id = (SELECT id FROM parent)
		  ))
		RETURNING id, parent_id, (SELECT parent_id FROM previous) AS previous_parent_id`,
		[newParentNumber, itemNumber, projectId]
	);
	// Zero rows means the item is gone, the new parent is, or the move would close a
	// cycle — and, critically, that the UPDATE wrote nothing. Checking after the fact
	// would already have detached the item from its real parent and reset its rank,
	// losing that link for good. Diagnose only on this rare path.
	if (result.rows.length === 0) {
		if (newParentNumber !== null) {
			if (!(await verifyItemOwnership(projectId, newParentNumber))) {
				throw new ParentItemNotFoundError(newParentNumber);
			}
			if (await wouldCreateCycle(projectId, itemNumber, newParentNumber)) throw new ItemCycleError();
		}
		return null;
	}
	// The item left one child set and joined another; both parents recompute.
	const { parent_id: parentId, previous_parent_id: previousParentId } = result.rows[0]!;
	if (previousParentId !== parentId) {
		await rollUpStatus(previousParentId, true);
		await rollUpStatus(parentId, true);
	}
	return getItemByNumber(projectId, itemNumber);
}

/** Delete an item (its children cascade via the parent_id FK), then recompute its parent. */
export async function deleteItem(projectId: string, itemNumber: number): Promise<boolean> {
	const result = await query<{ parent_id: string | null }>(
		'DELETE FROM items WHERE number = $1 AND project_id = $2 RETURNING parent_id',
		[itemNumber, projectId]
	);
	const deleted = result.rows[0];
	if (!deleted) return false;
	await rollUpStatus(deleted.parent_id, true);
	return true;
}

// ── Status lifecycle (applies to any item) ──────────────────────────────────

/** Start an item: in_progress, then roll its parent up. */
export async function startItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const result = await query<{ parent_id: string | null }>(
		`UPDATE items SET status = 'in_progress', status_source = 'explicit', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING parent_id`,
		[itemNumber, projectId]
	);
	const started = result.rows[0];
	if (!started) return null;
	await rollUpStatus(started.parent_id, true);
	return getItemByNumber(projectId, itemNumber);
}

/**
 * Complete an item. Auto-clears blockers (dependents' and its own, same
 * transaction) and ends active worker episodes.
 */
export async function completeItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const completed = await transaction(async (client) => {
		const result = await client.query<{ id: string; parent_id: string | null }>(
			`UPDATE items SET status = 'done', status_source = 'explicit', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING id, parent_id`,
			[itemNumber, projectId]
		);
		const row = result.rows[0];
		if (row) await clearBlockersForCompletion(client, row.id);
		return row;
	});
	if (!completed) return null;
	await endWorkers(projectId, itemNumber);
	await rollUpStatus(completed.parent_id, true);
	return getItemByNumber(projectId, itemNumber);
}

/** Block an item (a manual status-level hold). Ends worker episodes (no longer being worked). */
export async function blockItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const result = await query<{ parent_id: string | null }>(
		`UPDATE items SET status = 'blocked', status_source = 'explicit', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING parent_id`,
		[itemNumber, projectId]
	);
	const row = result.rows[0];
	if (!row) return null;
	await endWorkers(projectId, itemNumber);
	await rollUpStatus(row.parent_id, true);
	return getItemByNumber(projectId, itemNumber);
}

/** Unblock an item back to ready. Ends worker episodes (no longer being worked). */
export async function unblockItem(projectId: string, itemNumber: number): Promise<ItemResponse | null> {
	const result = await query<{ parent_id: string | null }>(
		`UPDATE items SET status = 'ready', status_source = 'explicit', updated_at = NOW() WHERE number = $1 AND project_id = $2 RETURNING parent_id`,
		[itemNumber, projectId]
	);
	const row = result.rows[0];
	if (!row) return null;
	await endWorkers(projectId, itemNumber);
	await rollUpStatus(row.parent_id, true);
	return getItemByNumber(projectId, itemNumber);
}
