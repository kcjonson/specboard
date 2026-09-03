/**
 * Blocker service — polymorphic blocked-by rows on items.
 *
 * Each row blocks an item on another item (FK) XOR free text. An item is blocked
 * while it has any open row (cleared_at IS NULL) or while its status is
 * 'blocked' (the separate manual hold; rows never mutate status). Item blockers
 * are cleared automatically when the blocking item reaches done, and an item's
 * own open rows are cleared when IT reaches done; text blockers otherwise clear
 * only when explicitly removed. Cleared rows are tombstones — reopening a done
 * blocking item does not re-block dependents. Deletion is the one operation
 * that erases history (FK cascades remove rows, tombstones included).
 *
 * Every blocker mutation bumps the affected item's updated_at: the board's
 * poll reconcile skips items whose updatedAt is unchanged, so without the bump
 * other sessions would never see derived blocked-state changes.
 *
 * Used by both API handlers and MCP tools.
 */

import type pg from 'pg';
import { formatItemKey } from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import type { Actor, ItemBlocker, ItemStatus } from '../types.ts';

export const MAX_BLOCKER_TEXT_LENGTH = 500;

/** Thrown when a blocker input is malformed (not exactly one of item/text, bad text). */
export class BlockerValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BlockerValidationError';
	}
}

/** Thrown when adding a blocker that is already open on the item. */
export class BlockerConflictError extends Error {
	constructor(message = 'That blocker is already open on this item') {
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
	if (raw.text.trim().length > MAX_BLOCKER_TEXT_LENGTH) {
		throw new BlockerValidationError(`Blocker text must be at most ${MAX_BLOCKER_TEXT_LENGTH} characters`);
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
	const item = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemId = item.rows[0]?.id;
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
 *
 * Runs in a transaction that takes FOR SHARE locks on the item rows it
 * validated, so a concurrent completeItem can't slip its status write and
 * auto-clear between the not-done check and the insert (the completion's
 * UPDATE blocks on the lock and, once it proceeds, sees the committed row).
 */
export async function addBlocker(
	projectId: string,
	itemNumber: number,
	input: BlockerInput,
	actor?: Actor
): Promise<BlockerSummary | null> {
	const validated = validateBlockerInput(input);
	const actorJson = actor ? JSON.stringify(actor) : null;

	const blockerId = await transaction(async (client) => {
		const itemRow = await lockItem(client, projectId, itemNumber);
		if (!itemRow) return null;
		if (itemRow.status === 'done') throw new BlockerTargetError('Cannot block a done item');

		let blockerItemId: string | null = null;
		if ('itemNumber' in validated) {
			blockerItemId = await resolveBlockerTarget(client, projectId, itemRow.id, validated.itemNumber);
		}

		let inserted;
		try {
			inserted = await client.query<{ id: string }>(
				`INSERT INTO item_blockers (item_id, project_id, blocker_item_id, blocker_text, created_by)
				 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
				[itemRow.id, projectId, blockerItemId, 'text' in validated ? validated.text : null, actorJson]
			);
		} catch (err) {
			if ((err as { code?: string }).code === '23505') throw new BlockerConflictError();
			throw err;
		}
		await bumpItem(client, itemRow.id);
		return inserted.rows[0]!.id;
	});

	if (!blockerId) return null;
	return getBlocker(projectId, blockerId);
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
	const result = await query<{ item_id: string }>(
		`UPDATE item_blockers b SET cleared_at = now(), cleared_by = $4
		 FROM items i
		 WHERE b.id = $1 AND b.cleared_at IS NULL
		   AND b.item_id = i.id AND i.number = $2 AND b.project_id = $3
		 RETURNING b.item_id`,
		[blockerId, itemNumber, projectId, actor ? JSON.stringify(actor) : null]
	);
	const itemId = result.rows[0]?.item_id;
	if (!itemId) return false;
	await query('UPDATE items SET updated_at = NOW() WHERE id = $1', [itemId]);
	return true;
}

/**
 * Replace an item's set of OPEN blockers with the given list (MCP full-replace,
 * mirroring setSpecs). Open rows not in the list are cleared by the actor; rows
 * already open are kept (their created_at/created_by survive); missing ones are
 * inserted. Returns the new open list, or null if the item doesn't exist.
 *
 * Sequential statements inside one transaction on purpose: data-modifying CTEs
 * share a snapshot, so a reconcile written as one statement couldn't see its
 * own clears. Targets are validated under the same locks as addBlocker.
 */
export async function setBlockers(
	projectId: string,
	itemNumber: number,
	inputs: BlockerInput[],
	actor?: Actor
): Promise<BlockerSummary[] | null> {
	const validated = inputs.map((input) => validateBlockerInput(input));
	const actorJson = actor ? JSON.stringify(actor) : null;

	const found = await transaction(async (client) => {
		const itemRow = await lockItem(client, projectId, itemNumber);
		if (!itemRow) return false;
		if (itemRow.status === 'done' && validated.length > 0) {
			throw new BlockerTargetError('Cannot block a done item');
		}

		// De-duplicate; resolve item refs under lock so a concurrent completion
		// can't invalidate the not-done check before the inserts commit.
		const wantTexts = new Set<string>();
		const wantItemIds = new Map<string, number>();
		for (const input of validated) {
			if ('text' in input) {
				wantTexts.add(input.text);
			} else {
				const id = await resolveBlockerTarget(client, projectId, itemRow.id, input.itemNumber);
				wantItemIds.set(id, input.itemNumber);
			}
		}

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
		try {
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
		} catch (err) {
			if ((err as { code?: string }).code === '23505') throw new BlockerConflictError();
			throw err;
		}
		await bumpItem(client, itemRow.id);
		return true;
	});

	if (!found) return null;
	return listBlockers(projectId, itemNumber);
}

/**
 * Completion side effect, run inside the caller's status-write transaction:
 * tombstone every open blocker pointing AT the completed item (its dependents
 * unblock, pure SQL), and the completed item's OWN open rows (done and blocked
 * must not coexist; addBlocker refuses done items, so completion may not
 * manufacture that state either). Dependents get their updated_at bumped so
 * polling boards pick up the derived change; the completed item's own bump
 * comes from the status write itself.
 */
export async function clearBlockersForCompletion(client: pg.PoolClient, itemId: string): Promise<void> {
	const cleared = await client.query<{ item_id: string }>(
		`UPDATE item_blockers
		 SET cleared_at = now(), cleared_by = '{"type":"system","cause":"blocking_item_done"}'::jsonb
		 WHERE blocker_item_id = $1 AND cleared_at IS NULL
		 RETURNING item_id`,
		[itemId]
	);
	const dependentIds = [...new Set(cleared.rows.map((r) => r.item_id))];
	if (dependentIds.length > 0) {
		await client.query('UPDATE items SET updated_at = NOW() WHERE id = ANY($1)', [dependentIds]);
	}
	await client.query(
		`UPDATE item_blockers
		 SET cleared_at = now(), cleared_by = '{"type":"system","cause":"item_completed"}'::jsonb
		 WHERE item_id = $1 AND cleared_at IS NULL`,
		[itemId]
	);
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Lock the blocked item's row for the duration of a blocker write. */
async function lockItem(
	client: pg.PoolClient,
	projectId: string,
	itemNumber: number
): Promise<{ id: string; status: ItemStatus } | null> {
	const result = await client.query<{ id: string; status: ItemStatus }>(
		'SELECT id, status FROM items WHERE number = $1 AND project_id = $2 FOR SHARE',
		[itemNumber, projectId]
	);
	return result.rows[0] ?? null;
}

/** Resolve a blocker target to its id under lock, enforcing same-project, not-self, not-done. */
async function resolveBlockerTarget(
	client: pg.PoolClient,
	projectId: string,
	itemId: string,
	targetNumber: number
): Promise<string> {
	const target = await client.query<{ id: string; status: ItemStatus }>(
		'SELECT id, status FROM items WHERE number = $1 AND project_id = $2 FOR SHARE',
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

async function bumpItem(client: pg.PoolClient, itemId: string): Promise<void> {
	await client.query('UPDATE items SET updated_at = NOW() WHERE id = $1', [itemId]);
}

async function getBlocker(projectId: string, blockerId: string): Promise<BlockerSummary | null> {
	const result = await query<BlockerRow>(
		`${BLOCKER_SELECT} WHERE b.project_id = $1 AND b.id = $2`,
		[projectId, blockerId]
	);
	const row = result.rows[0];
	return row ? toSummary(row) : null;
}
