/**
 * Item service tests — rank assignment and stable ordering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import type { Item, ItemOrigin } from '../types.ts';

const { mockClientQuery } = vi.hoisted(() => ({ mockClientQuery: vi.fn() }));

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

import { query, transaction } from '../index.ts';
import { createItem, createItems, getItems, moveItem, completeItem, updateItem } from './items.ts';

const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

const ORIGIN: ItemOrigin = { actor: { type: 'user', userId: 'user-1' } };
const ORIGIN_JSON = JSON.stringify(ORIGIN);

type ItemRow = Item & { project_key: string };

function makeItem(overrides: Partial<ItemRow> = {}): ItemRow {
	return {
		id: 'item-1',
		project_id: 'proj-1',
		project_key: 'SB',
		number: 1,
		parent_id: null,
		type: 'epic',
		title: 'Test item',
		description: null,
		status: 'ready',
		sub_status: 'not_started',
		origin: ORIGIN,
		assignee: null,
		rank: 1,
		due_date: null,
		pr_url: null,
		branch_name: null,
		created_at: new Date('2026-01-01'),
		updated_at: new Date('2026-01-01'),
		...overrides,
	} as ItemRow;
}

function insertResult(overrides: Partial<ItemRow> = {}): QueryResult<ItemRow> {
	return { rows: [makeItem(overrides)], rowCount: 1 } as QueryResult<ItemRow>;
}

beforeEach(() => {
	mockQuery.mockReset();
	mockClientQuery.mockReset();
	mockTransaction.mockClear();
});

describe('createItem', () => {
	it('computes rank inside the INSERT for top-level items (single statement, no pre-read)', async () => {
		mockQuery.mockResolvedValue(insertResult());

		await createItem('proj-1', { title: 'Epic A', origin: ORIGIN });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('INSERT INTO items');
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $1 AND parent_id IS NULL)');
		expect(sql).toContain('UPDATE projects SET item_seq = item_seq + 1');
		expect(params).toEqual(['proj-1', null, 'epic', 'Epic A', null, 'ready', 'not_started', ORIGIN_JSON]);
	});

	it('computes rank inside the INSERT for child items scoped to the parent', async () => {
		mockQuery.mockResolvedValue(insertResult({ parent_id: 'parent-1', number: 7, type: 'task' }));

		await createItem('proj-1', { title: 'Task A', type: 'task', parentNumber: 7, origin: ORIGIN });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(params).toEqual(['proj-1', 7, 'task', 'Task A', null, 'ready', 'not_started', ORIGIN_JSON]);
	});

	it('uses an explicit rank verbatim when provided', async () => {
		mockQuery.mockResolvedValue(insertResult({ rank: 2.5 }));

		await createItem('proj-1', { title: 'Ranked', rank: 2.5, origin: ORIGIN });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('MAX(rank)');
		expect(sql).toContain('$9');
		expect(params).toEqual(['proj-1', null, 'epic', 'Ranked', null, 'ready', 'not_started', ORIGIN_JSON, 2.5]);
	});

	it('snapshots discoveredFrom into origin before the INSERT', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'source-id', key: 'SB' }], rowCount: 1 } as never)
			.mockResolvedValueOnce(insertResult());

		await createItem('proj-1', { title: 'Found', origin: ORIGIN, discoveredFromNumber: 12 });

		expect(mockQuery).toHaveBeenCalledTimes(2);
		const [, insertParams] = mockQuery.mock.calls[1]!;
		expect(insertParams![7]).toBe(JSON.stringify({
			...ORIGIN,
			discoveredFrom: { itemId: 'source-id', itemKey: 'SB-12' },
		}));
	});
});

describe('createItems', () => {
	it('inserts the whole batch in one statement, ranking off a single MAX(rank) base', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				makeItem({ id: 'a', parent_id: 'parent-1', type: 'task', rank: 4 }),
				makeItem({ id: 'b', parent_id: 'parent-1', type: 'bug', rank: 5 }),
			],
			rowCount: 2,
		} as QueryResult<ItemRow>);

		const created = await createItems('proj-1', 3, [
			{ title: 'One' },
			{ title: 'Two', type: 'bug', description: 'details' },
		], ORIGIN);

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(sql).toContain('row_number() OVER (ORDER BY v.ord)');
		expect(sql).toContain('WITH ORDINALITY');
		expect(sql).toContain('UPDATE projects SET item_seq = item_seq + $6');
		expect(params).toEqual(['proj-1', 3, ['task', 'bug'], ['One', 'Two'], [null, 'details'], 2, ORIGIN_JSON]);
		expect(created.map((c) => c.id)).toEqual(['a', 'b']);
		expect(created[0]).toMatchObject({
			parentId: 'parent-1',
			status: 'ready',
			childStats: { total: 0, done: 0, inProgress: 0, blocked: 0 },
		});
	});

	it('returns items in rank order regardless of row order from the database', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				makeItem({ id: 'b', parent_id: 'parent-1', rank: 2 }),
				makeItem({ id: 'a', parent_id: 'parent-1', rank: 1 }),
			],
			rowCount: 2,
		} as QueryResult<ItemRow>);

		const created = await createItems('proj-1', 3, [{ title: 'One' }, { title: 'Two' }], ORIGIN);

		expect(created.map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('skips the query entirely for an empty batch', async () => {
		const created = await createItems('proj-1', 3, [], ORIGIN);

		expect(created).toEqual([]);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe('getItems', () => {
	it('orders top-level items by rank with created_at and id tiebreakers', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1' });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('ORDER BY i.rank ASC, i.created_at ASC, i.id ASC');
	});

	it('derives blocked from status OR an open blocker row, via a one-to-one CTE join', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1' });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('WITH open_blocks AS');
		expect(sql).toContain('SELECT DISTINCT item_id FROM item_blockers WHERE project_id = $1 AND cleared_at IS NULL');
		expect(sql).toContain(`(i.status = 'blocked' OR ob.item_id IS NOT NULL) as blocked`);
		expect(sql).toContain(`FILTER (WHERE c.status = 'blocked' OR cob.item_id IS NOT NULL) as blocked_count`);
		expect(sql).toContain('GROUP BY i.id, p.key, parent.number, ob.item_id');
	});

	it('excludeBlocked drops status-blocked and row-blocked items from lists', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', status: 'ready', excludeBlocked: true });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain(`AND NOT (i.status = 'blocked' OR ob.item_id IS NOT NULL)`);
	});

	it('includeNotes hydrates each item with its activity-log entries, newest first', async () => {
		const parent = {
			...makeItem(),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
		};
		mockQuery
			.mockResolvedValueOnce({ rows: [parent], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [
				{ id: 'note-2', item_id: 'item-1', note: 'newer', actor: null, created_at: new Date('2026-02-02') },
				{ id: 'note-1', item_id: 'item-1', note: 'older', actor: { type: 'user', userId: 'user-1' }, created_at: new Date('2026-02-01') },
			], rowCount: 2 } as never);

		const [item] = await getItems({ projectId: 'proj-1', includeNotes: true });

		const [notesSql] = mockQuery.mock.calls[1]!;
		expect(notesSql).toContain('FROM item_notes WHERE item_id = ANY($1) ORDER BY created_at DESC');
		expect(item!.notes).toEqual([
			{ id: 'note-2', note: 'newer', actor: null, createdAt: new Date('2026-02-02') },
			{ id: 'note-1', note: 'older', actor: { type: 'user', userId: 'user-1' }, createdAt: new Date('2026-02-01') },
		]);
	});

	it('omits notes entirely when they were not requested', async () => {
		const parent = {
			...makeItem(),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
		};
		mockQuery.mockResolvedValueOnce({ rows: [parent], rowCount: 1 } as never);

		const [item] = await getItems({ projectId: 'proj-1' });

		expect(item!).not.toHaveProperty('notes');
	});

	it('orders children by rank with created_at and id tiebreakers', async () => {
		const parent = {
			...makeItem(),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
		};
		mockQuery
			.mockResolvedValueOnce({ rows: [parent], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', includeChildren: true });

		const [childSql] = mockQuery.mock.calls[1]!;
		expect(childSql).toContain('ORDER BY c.rank ASC, c.created_at ASC, c.id ASC');
	});
});

describe('moveItem', () => {
	it('re-ranks via an inline subquery in the UPDATE', async () => {
		mockQuery
			.mockResolvedValueOnce(insertResult({ parent_id: 'parent-2' }))
			.mockResolvedValueOnce({
				rows: [{
					...makeItem({ parent_id: 'parent-2' }),
					child_count: '0',
					done_count: '0',
					in_progress_count: '0',
					blocked_count: '0',
				}],
				rowCount: 1,
			} as never);

		await moveItem('proj-1', 1, 2);

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('UPDATE items SET parent_id = (SELECT id FROM parent)');
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(params).toEqual([2, 1, 'proj-1']);
	});

	it('re-ranks against top-level siblings when promoting to standalone', async () => {
		mockQuery
			.mockResolvedValueOnce(insertResult())
			.mockResolvedValueOnce({
				rows: [{
					...makeItem(),
					child_count: '0',
					done_count: '0',
					in_progress_count: '0',
					blocked_count: '0',
				}],
				rowCount: 1,
			} as never);

		await moveItem('proj-1', 1, null);

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $3 AND parent_id IS NULL)');
		expect(params).toEqual([null, 1, 'proj-1']);
	});
});

describe('reaching done', () => {
	const detailRow = {
		...makeItem({ status: 'done' }),
		blocked: false,
		child_count: '0',
		done_count: '0',
		in_progress_count: '0',
		blocked_count: '0',
	};

	it('completeItem clears dependent and own blockers in the same transaction, then ends workers', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 0 })
			.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [detailRow], rowCount: 1 } as never);

		await completeItem('proj-1', 1);

		expect(mockTransaction).toHaveBeenCalledTimes(1);
		const [updateSql] = mockClientQuery.mock.calls[0]!;
		expect(updateSql).toContain(`SET status = 'done'`);
		const [depSql, depParams] = mockClientQuery.mock.calls[1]!;
		expect(depSql).toContain(`'{"type":"system","cause":"blocking_item_done"}'::jsonb`);
		expect(depSql).toContain('WHERE blocker_item_id = $1 AND cleared_at IS NULL');
		expect(depParams).toEqual(['item-1']);
		const [ownSql, ownParams] = mockClientQuery.mock.calls[2]!;
		expect(ownSql).toContain(`'{"type":"system","cause":"item_completed"}'::jsonb`);
		expect(ownParams).toEqual(['item-1']);
		const [endWorkersSql] = mockQuery.mock.calls[0]!;
		expect(endWorkersSql).toContain('UPDATE item_workers');
	});

	it('updateItem to done runs the same clear inside a transaction; other statuses do not', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 0 })
			.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [detailRow], rowCount: 1 } as never);

		await updateItem('proj-1', 1, { subStatus: 'complete' });
		expect(mockTransaction).toHaveBeenCalledTimes(1);

		mockQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 } as never);
		await updateItem('proj-1', 1, { title: 'renamed' });
		expect(mockTransaction).toHaveBeenCalledTimes(1);
	});

	it('updateItem ends worker episodes on any status transition out of in_progress', async () => {
		mockQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 } as never);

		await updateItem('proj-1', 1, { status: 'ready' });
		const endCall = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('UPDATE item_workers'));
		expect(endCall).toBeDefined();

		mockQuery.mockClear();
		mockQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 } as never);
		await updateItem('proj-1', 1, { status: 'in_progress' });
		expect(mockQuery.mock.calls.some(([sql]) => (sql as string).includes('UPDATE item_workers'))).toBe(false);
	});
});
