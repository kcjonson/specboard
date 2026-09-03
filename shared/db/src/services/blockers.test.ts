/**
 * Blocker service tests — validation, target rules, reconciliation, auto-clear.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import type { Actor } from '../types.ts';

const { mockClientQuery } = vi.hoisted(() => ({ mockClientQuery: vi.fn() }));

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

import { query, transaction } from '../index.ts';
import {
	validateBlockerInput,
	addBlocker,
	clearBlocker,
	setBlockers,
	clearBlockersForCompletion,
	BlockerValidationError,
	BlockerTargetError,
	BlockerConflictError,
	MAX_BLOCKER_TEXT_LENGTH,
} from './blockers.ts';

const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

const ACTOR: Actor = { type: 'user', userId: 'user-1' };

beforeEach(() => {
	mockQuery.mockReset();
	mockClientQuery.mockReset();
	mockTransaction.mockClear();
});

describe('validateBlockerInput', () => {
	it('accepts exactly one of item number or text', () => {
		expect(validateBlockerInput({ itemNumber: 12 })).toEqual({ itemNumber: 12 });
		expect(validateBlockerInput({ text: ' waiting on legal ' })).toEqual({ text: 'waiting on legal' });
	});

	it('rejects both, neither, empty text, and over-long text', () => {
		expect(() => validateBlockerInput({})).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ itemNumber: 1, text: 'x' })).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ text: '   ' })).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ itemNumber: 0 })).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ text: 'x'.repeat(MAX_BLOCKER_TEXT_LENGTH + 1) })).toThrow(BlockerValidationError);
	});
});

describe('addBlocker', () => {
	it('locks the blocked item and rejects when it is done', async () => {
		mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'done' }], rowCount: 1 });

		await expect(addBlocker('proj-1', 1, { text: 'hold' }, ACTOR)).rejects.toThrow(BlockerTargetError);
		const [lockSql] = mockClientQuery.mock.calls[0]!;
		expect(lockSql).toContain('FOR SHARE');
	});

	it('rejects a done item as a blocker (it could never clear naturally)', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ id: 'item-2', status: 'done' }], rowCount: 1 });

		await expect(addBlocker('proj-1', 1, { itemNumber: 2 }, ACTOR)).rejects.toThrow(BlockerTargetError);
	});

	it('rejects self-blocking', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 });

		await expect(addBlocker('proj-1', 1, { itemNumber: 1 }, ACTOR)).rejects.toThrow(BlockerTargetError);
	});

	it('maps a unique-index violation to BlockerConflictError', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ id: 'item-2', status: 'ready' }], rowCount: 1 })
			.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

		await expect(addBlocker('proj-1', 1, { itemNumber: 2 }, ACTOR)).rejects.toThrow(BlockerConflictError);
	});

	it('inserts with the actor recorded and bumps the item updated_at', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ id: 'blocker-1' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 1 });
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await addBlocker('proj-1', 1, { text: 'hold' }, ACTOR);

		const [insertSql, insertParams] = mockClientQuery.mock.calls[1]!;
		expect(insertSql).toContain('INSERT INTO item_blockers');
		expect(insertParams).toEqual(['item-1', 'proj-1', null, 'hold', JSON.stringify(ACTOR)]);
		const [bumpSql, bumpParams] = mockClientQuery.mock.calls[2]!;
		expect(bumpSql).toContain('UPDATE items SET updated_at = NOW()');
		expect(bumpParams).toEqual(['item-1']);
	});
});

describe('clearBlocker', () => {
	it('tombstones and bumps the item updated_at', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ item_id: 'item-1' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

		const cleared = await clearBlocker('proj-1', 1, 'blocker-1', ACTOR);

		expect(cleared).toBe(true);
		const [clearSql] = mockQuery.mock.calls[0]!;
		expect(clearSql).toContain('SET cleared_at = now()');
		const [bumpSql, bumpParams] = mockQuery.mock.calls[1]!;
		expect(bumpSql).toContain('UPDATE items SET updated_at = NOW()');
		expect(bumpParams).toEqual(['item-1']);
	});
});

describe('setBlockers', () => {
	it('reconciles: clears open rows not in the list, inserts missing, keeps matches — never DELETEs', async () => {
		mockClientQuery
			// lockItem
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			// resolveBlockerTarget for itemNumber 2
			.mockResolvedValueOnce({ rows: [{ id: 'blocker-item-2', status: 'ready' }], rowCount: 1 })
			// open rows: one kept text, one stale text to clear
			.mockResolvedValueOnce({ rows: [
				{ id: 'row-keep', blocker_item_id: null, blocker_text: 'kept reason' },
				{ id: 'row-stale', blocker_item_id: null, blocker_text: 'old reason' },
			], rowCount: 2 })
			.mockResolvedValue({ rows: [], rowCount: 0 });
		// final listBlockers: item lookup + list
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await setBlockers('proj-1', 1, [{ text: 'kept reason' }, { itemNumber: 2 }], ACTOR);

		const statements = mockClientQuery.mock.calls.map(([sql]) => sql as string);
		expect(statements.some((s) => s.includes('SET cleared_at = now()'))).toBe(true);
		expect(statements.some((s) => s.includes('INSERT INTO item_blockers'))).toBe(true);
		expect(statements.some((s) => s.includes('UPDATE items SET updated_at = NOW()'))).toBe(true);
		expect(statements.every((s) => !s.trimStart().startsWith('DELETE'))).toBe(true);
		// The clear targets only the stale row.
		const clearCall = mockClientQuery.mock.calls.find(([sql]) => (sql as string).includes('SET cleared_at = now()'))!;
		expect(clearCall[1]).toEqual([['row-stale'], JSON.stringify(ACTOR)]);
	});

	it('maps a concurrent duplicate insert to BlockerConflictError', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ id: 'blocker-item-2', status: 'ready' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 0 })
			.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

		await expect(setBlockers('proj-1', 1, [{ itemNumber: 2 }], ACTOR)).rejects.toThrow(BlockerConflictError);
	});
});

describe('clearBlockersForCompletion', () => {
	it('tombstones dependents (bumping their updated_at) and the item\'s own open rows', async () => {
		const client = { query: mockClientQuery } as unknown as pg.PoolClient;
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ item_id: 'dep-1' }, { item_id: 'dep-1' }, { item_id: 'dep-2' }], rowCount: 3 })
			.mockResolvedValueOnce({ rows: [], rowCount: 2 })
			.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		await clearBlockersForCompletion(client, 'done-item-id');

		const [depSql, depParams] = mockClientQuery.mock.calls[0]!;
		expect(depSql).toContain(`cleared_by = '{"type":"system","cause":"blocking_item_done"}'::jsonb`);
		expect(depSql).toContain('WHERE blocker_item_id = $1 AND cleared_at IS NULL');
		expect(depParams).toEqual(['done-item-id']);
		const [bumpSql, bumpParams] = mockClientQuery.mock.calls[1]!;
		expect(bumpSql).toContain('UPDATE items SET updated_at = NOW()');
		expect(bumpParams).toEqual([['dep-1', 'dep-2']]);
		const [ownSql, ownParams] = mockClientQuery.mock.calls[2]!;
		expect(ownSql).toContain(`cleared_by = '{"type":"system","cause":"item_completed"}'::jsonb`);
		expect(ownSql).toContain('WHERE item_id = $1 AND cleared_at IS NULL');
		expect(ownParams).toEqual(['done-item-id']);
	});
});
