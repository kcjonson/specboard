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
	setBlockers,
	clearBlockersOnDone,
	BlockerValidationError,
	BlockerTargetError,
	BlockerConflictError,
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

	it('rejects both, neither, and empty text', () => {
		expect(() => validateBlockerInput({})).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ itemNumber: 1, text: 'x' })).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ text: '   ' })).toThrow(BlockerValidationError);
		expect(() => validateBlockerInput({ itemNumber: 0 })).toThrow(BlockerValidationError);
	});
});

describe('addBlocker', () => {
	it('rejects blocking a done item', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'done' }], rowCount: 1 } as never);

		await expect(addBlocker('proj-1', 1, { text: 'hold' }, ACTOR)).rejects.toThrow(BlockerTargetError);
	});

	it('rejects a done item as a blocker (it could never clear naturally)', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 'item-2', status: 'done' }], rowCount: 1 } as never);

		await expect(addBlocker('proj-1', 1, { itemNumber: 2 }, ACTOR)).rejects.toThrow(BlockerTargetError);
	});

	it('rejects self-blocking', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never);

		await expect(addBlocker('proj-1', 1, { itemNumber: 1 }, ACTOR)).rejects.toThrow(BlockerTargetError);
	});

	it('maps a unique-index violation to BlockerConflictError', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 'item-2', status: 'ready' }], rowCount: 1 } as never)
			.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

		await expect(addBlocker('proj-1', 1, { itemNumber: 2 }, ACTOR)).rejects.toThrow(BlockerConflictError);
	});

	it('inserts with the actor recorded as created_by', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 'blocker-1' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await addBlocker('proj-1', 1, { text: 'hold' }, ACTOR);

		const [insertSql, insertParams] = mockQuery.mock.calls[1]!;
		expect(insertSql).toContain('INSERT INTO item_blockers');
		expect(insertParams).toEqual(['item-1', 'proj-1', null, 'hold', JSON.stringify(ACTOR)]);
	});
});

describe('setBlockers', () => {
	it('reconciles: clears open rows not in the list, inserts missing, keeps matches — never DELETEs', async () => {
		mockQuery
			// item lookup
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'ready' }], rowCount: 1 } as never)
			// resolveBlockerTarget for itemNumber 2
			.mockResolvedValueOnce({ rows: [{ id: 'blocker-item-2', status: 'ready' }], rowCount: 1 } as never)
			// final listBlockers: item lookup + list
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
		mockClientQuery
			// open rows: one kept text, one stale text to clear
			.mockResolvedValueOnce({ rows: [
				{ id: 'row-keep', blocker_item_id: null, blocker_text: 'kept reason' },
				{ id: 'row-stale', blocker_item_id: null, blocker_text: 'old reason' },
			], rowCount: 2 })
			.mockResolvedValue({ rows: [], rowCount: 0 });

		await setBlockers('proj-1', 1, [{ text: 'kept reason' }, { itemNumber: 2 }], ACTOR);

		const statements = mockClientQuery.mock.calls.map(([sql]) => sql as string);
		expect(statements.some((s) => s.includes('SET cleared_at = now()'))).toBe(true);
		expect(statements.some((s) => s.includes('INSERT INTO item_blockers'))).toBe(true);
		expect(statements.every((s) => !s.trimStart().startsWith('DELETE'))).toBe(true);
		// The clear targets only the stale row.
		const clearCall = mockClientQuery.mock.calls.find(([sql]) => (sql as string).includes('SET cleared_at = now()'))!;
		expect(clearCall[1]).toEqual([['row-stale'], JSON.stringify(ACTOR)]);
	});
});

describe('clearBlockersOnDone', () => {
	it('tombstones open rows pointing at the completed item with a system actor', async () => {
		const client = { query: mockClientQuery } as unknown as pg.PoolClient;
		mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		await clearBlockersOnDone(client, 'done-item-id');

		const [sql, params] = mockClientQuery.mock.calls[0]!;
		expect(sql).toContain(`cleared_by = '{"type":"system","cause":"blocking_item_done"}'::jsonb`);
		expect(sql).toContain('WHERE blocker_item_id = $1 AND cleared_at IS NULL');
		expect(params).toEqual(['done-item-id']);
	});
});
