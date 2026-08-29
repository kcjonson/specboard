/**
 * Blocker service — polymorphic blocked-by rows on items.
 *
 * Each row blocks an item on another item (FK) XOR free text. An item is blocked
 * while it has any open row (cleared_at IS NULL) or while its status is
 * 'blocked' (the separate manual hold; rows never mutate status). Item blockers
 * are cleared automatically when the blocking item reaches done; text blockers
 * only when explicitly removed. Cleared rows are tombstones — reopening a done
 * blocking item does not re-block dependents.
 *
 * Used by both API handlers and MCP tools.
 */

import type pg from 'pg';
import { formatItemKey } from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import type { Actor, ItemBlocker, ItemStatus } from '../types.ts';

/** Thrown when a blocker input is malformed (not exactly one of item/text, bad text). */
export class BlockerValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BlockerValidationError';
	}
}

/** Thrown when adding an item blocker that is already open on the item. */
export class BlockerConflictError extends Error {
	constructor(message = 'That item is already an open blocker on this item') {
		super(message);
		this.name = 'BlockerConflictError';
	}
}

/**
 * Thrown when a blocker references an unusable item: the target doesn't exist in
 * the project, is the item itself, or is already done (it could never clear
 * naturally). Also used when blocking an already-done item.
 */
export class BlockerTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BlockerTargetError';
	}
}

/** One blocker for exactly one of the two kinds. */
export type BlockerInput = { itemNumber: number } | { text: string };

export interface BlockerSummary {
	id: string;
	type: 'item' | 'text';
	/** The reason text (text blockers only). */
	text: string | null;
	/**
	 * Key/title/status of the blocking item (item blockers only). Named blocker*
	 * everywhere — service, API, MCP — so they can't be confused with (or, in
	 * client models, clobber) the blocked item's own key.
	 */
	blockerKey: string | null;
	blockerTitle: string | null;
	blockerStatus: ItemStatus | null;
	createdBy: Actor | null;
	createdAt: Date;
	clearedAt: Date | null;
	clearedBy: Actor | null;
}

type BlockerRow = ItemBlocker & {
	project_key: string;
	blocker_number: number | null;
	blocker_title: string | null;
	blocker_status: ItemStatus | null;
};

function toSummary(row: BlockerRow): BlockerSummary {
	return {
		id: row.id,
		type: row.blocker_item_id !== null ? 'item' : 'text',
		text: row.blocker_text,
		blockerKey: row.blocker_number === null ? null : formatItemKey(row.project_key, row.blocker_number),
		blockerTitle: row.blocker_title,
		blockerStatus: row.blocker_status,
		createdBy: row.created_by,
		createdAt: row.created_at,
		clearedAt: row.cleared_at,
		clearedBy: row.cleared_by,
	};
}

/** Validate raw blocker input into exactly one of the two kinds. */
export function validateBlockerInput(raw: { itemNumber?: unknown; text?: unknown }): BlockerInput {
	const hasItem = raw.itemNumber !== undefined && raw.itemNumber !== null;
	const hasText = raw.text !== undefined && raw.text !== null;
	if (hasItem === hasText) {
		throw new BlockerValidationError('A blocker is exactly one of: an item, or text');
	}
	if (hasItem) {
		if (typeof raw.itemNumber !== 'number' || !Number.isInteger(raw.itemNumber) || raw.itemNumber < 1) {
			throw new BlockerValidationError('Invalid blocker item number');
		}
		return { itemNumber: raw.itemNumber };
	}
	if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
		throw new BlockerValidationError('Blocker text must be a non-empty string');
	}
	return { text: raw.text.trim() };
}

const BLOCKER_SELECT = `
	SELECT b.*, p.key AS project_key,
		bi.number AS blocker_number, bi.title AS blocker_title, bi.status AS blocker_status
	FROM item_blockers b
	JOIN projects p ON p.id = b.project_id
	LEFT JOIN items bi ON bi.id = b.blocker_item_id
`;

/** List an item's blockers, open only by default, oldest first. */
export async function listBlockers(
	projectId: string,
	itemNumber: number,
	opts: { includeCleared?: boolean } = {}
): Promise<BlockerSummary[] | null> {
	const itemId = await resolveItemId(projectId, itemNumber);
	if (!itemId) return null;
	const result = await query<BlockerRow>(
		`${BLOCKER_SELECT}
		 WHERE b.project_id = $1 AND b.item_id = $2 ${opts.includeCleared ? '' : 'AND b.cleared_at IS NULL'}
		 ORDER BY b.created_at ASC`,
		[projectId, itemId]
	);
	return result.rows.map(toSummary);
}

/**
 * Add one blocker to an item. Item blockers must reference a distinct,
 * not-done item in the same project; the blocked item itself must not be done.
 * Returns null if the item doesn't exist in the project.
 */
export async function addBlocker(
	projectId: string,
	itemNumber: number,
	input: BlockerInput,
	actor?: Actor
): Promise<BlockerSummary | null> {
	const item = await query<{ id: string; status: ItemStatus }>(
		'SELECT id, status FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemRow = item.rows[0];
	if (!itemRow) return null;
	if (itemRow.status === 'done') {
		throw new BlockerTargetError('Cannot block a done item');
	}

	let blockerItemId: string | null = null;
	if ('itemNumber' in input) {
		blockerItemId = await resolveBlockerTarget(projectId, itemRow.id, input.itemNumber);
	}

	try {
		const result = await query<{ id: string }>(
			`INSERT INTO item_blockers (item_id, project_id, blocker_item_id, blocker_text, created_by)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			[itemRow.id, projectId, blockerItemId, 'text' in input ? input.text : null, actor ? JSON.stringify(actor) : null]
		);
		return await getBlocker(projectId, result.rows[0]!.id);
	} catch (err) {
		if ((err as { code?: string }).code === '23505') throw new BlockerConflictError();
		throw err;
	}
}

/**
 * Clear one blocker (tombstone: sets cleared_at/cleared_by, never deletes).
 * Returns true if an open row was cleared.
 */
export async function clearBlocker(
	projectId: string,
	itemNumber: number,
	blockerId: string,
	actor?: Actor
): Promise<boolean> {
	const result = await query(
		`UPDATE item_blockers b SET cleared_at = now(), cleared_by = $4
		 FROM items i
		 WHERE b.id = $1 AND b.cleared_at IS NULL
		   AND b.item_id = i.id AND i.number = $2 AND b.project_id = $3`,
		[blockerId, itemNumber, projectId, actor ? JSON.stringify(actor) : null]
	);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Replace an item's set of OPEN blockers with the given list (MCP full-replace,
 * mirroring setSpecs). Open rows not in the list are cleared by the actor; rows
 * already open are kept (their created_at/created_by survive); missing ones are
 * inserted. Returns the new open list, or null if the item doesn't exist.
 *
 * Sequential statements inside one transaction on purpose: data-modifying CTEs
 * share a snapshot, so a reconcile written as one statement couldn't see its
 * own clears.
 */
export async function setBlockers(
	projectId: string,
	itemNumber: number,
	inputs: BlockerInput[],
	actor?: Actor
): Promise<BlockerSummary[] | null> {
	const item = await query<{ id: string; status: ItemStatus }>(
		'SELECT id, status FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemRow = item.rows[0];
	if (!itemRow) return null;
	if (itemRow.status === 'done' && inputs.length > 0) {
		throw new BlockerTargetError('Cannot block a done item');
	}

	// De-duplicate; resolve item refs up front so validation failures happen
	// before any write.
	const wantTexts = new Set<string>();
	const wantItemIds = new Map<string, number>();
	for (const input of inputs) {
		if ('text' in input) {
			wantTexts.add(input.text);
		} else {
			const id = await resolveBlockerTarget(projectId, itemRow.id, input.itemNumber);
			wantItemIds.set(id, input.itemNumber);
		}
	}

	const actorJson = actor ? JSON.stringify(actor) : null;
	await transaction(async (client) => {
		const open = await client.query<{ id: string; blocker_item_id: string | null; blocker_text: string | null }>(
			'SELECT id, blocker_item_id, blocker_text FROM item_blockers WHERE item_id = $1 AND cleared_at IS NULL',
			[itemRow.id]
		);
		const toClear: string[] = [];
		for (const row of open.rows) {
			const kept = row.blocker_item_id !== null
				? wantItemIds.delete(row.blocker_item_id)
				: wantTexts.delete(row.blocker_text!);
			if (!kept) toClear.push(row.id);
		}
		if (toClear.length > 0) {
			await client.query(
				'UPDATE item_blockers SET cleared_at = now(), cleared_by = $2 WHERE id = ANY($1)',
				[toClear, actorJson]
			);
		}
		for (const blockerItemId of wantItemIds.keys()) {
			await client.query(
				`INSERT INTO item_blockers (item_id, project_id, blocker_item_id, created_by)
				 VALUES ($1, $2, $3, $4)`,
				[itemRow.id, projectId, blockerItemId, actorJson]
			);
		}
		for (const text of wantTexts) {
			await client.query(
				`INSERT INTO item_blockers (item_id, project_id, blocker_text, created_by)
				 VALUES ($1, $2, $3, $4)`,
				[itemRow.id, projectId, text, actorJson]
			);
		}
	});

	return listBlockers(projectId, itemNumber);
}

/** Batch-load open blockers for many items (item-response hydration). */
export async function listOpenBlockersByItems(
	projectId: string,
	itemIds: string[]
): Promise<Map<string, BlockerSummary[]>> {
	const result = await query<BlockerRow>(
		`${BLOCKER_SELECT}
		 WHERE b.project_id = $1 AND b.item_id = ANY($2) AND b.cleared_at IS NULL
		 ORDER BY b.created_at ASC`,
		[projectId, itemIds]
	);
	const byItem = new Map<string, BlockerSummary[]>();
	for (const row of result.rows) {
		const existing = byItem.get(row.item_id) || [];
		existing.push(toSummary(row));
		byItem.set(row.item_id, existing);
	}
	return byItem;
}

/**
 * Auto-clear: tombstone every open blocker that points at an item which just
 * reached done. Pure SQL, runs inside the caller's transaction alongside the
 * status write.
 */
export async function clearBlockersOnDone(client: pg.PoolClient, blockingItemId: string): Promise<void> {
	await client.query(
		`UPDATE item_blockers
		 SET cleared_at = now(), cleared_by = '{"type":"system","cause":"blocking_item_done"}'::jsonb
		 WHERE blocker_item_id = $1 AND cleared_at IS NULL`,
		[blockingItemId]
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveItemId(projectId: string, itemNumber: number): Promise<string | null> {
	const result = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	return result.rows[0]?.id ?? null;
}

/** Resolve a blocker target to its id, enforcing same-project, not-self, not-done. */
async function resolveBlockerTarget(projectId: string, itemId: string, targetNumber: number): Promise<string> {
	const target = await query<{ id: string; status: ItemStatus }>(
		'SELECT id, status FROM items WHERE number = $1 AND project_id = $2',
		[targetNumber, projectId]
	);
	const row = target.rows[0];
	if (!row) throw new BlockerTargetError(`No item numbered ${targetNumber} in this project`);
	if (row.id === itemId) throw new BlockerTargetError('An item cannot block itself');
	if (row.status === 'done') {
		throw new BlockerTargetError(`Item ${targetNumber} is already done — it cannot be a blocker`);
	}
	return row.id;
}

async function getBlocker(projectId: string, blockerId: string): Promise<BlockerSummary | null> {
	const result = await query<BlockerRow>(
		`${BLOCKER_SELECT} WHERE b.project_id = $1 AND b.id = $2`,
		[projectId, blockerId]
	);
	const row = result.rows[0];
	return row ? toSummary(row) : null;
}
