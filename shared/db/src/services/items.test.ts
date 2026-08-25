/**
 * Item service tests — rank assignment and stable ordering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import type { Item } from '../types.ts';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
}));

import { query } from '../index.ts';
import { createItem, createItems, getItems, moveItem } from './items.ts';

const mockQuery = vi.mocked(query);

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
		creator: null,
		assignee: null,
		rank: 1,
		due_date: null,
		pr_url: null,
		branch_name: null,
		notes: null,
		note: null,
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
});

describe('createItem', () => {
	it('computes rank inside the INSERT for top-level items (single statement, no pre-read)', async () => {
		mockQuery.mockResolvedValue(insertResult());

		await createItem('proj-1', { title: 'Epic A' });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('INSERT INTO items');
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $1 AND parent_id IS NULL)');
		expect(sql).toContain('UPDATE projects SET item_seq = item_seq + 1');
		expect(params).toEqual(['proj-1', null, 'epic', 'Epic A', null, 'ready', 'not_started', null]);
	});

	it('computes rank inside the INSERT for child items scoped to the parent', async () => {
		mockQuery.mockResolvedValue(insertResult({ parent_id: 'parent-1', number: 7, type: 'task' }));

		await createItem('proj-1', { title: 'Task A', type: 'task', parentNumber: 7 });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(params).toEqual(['proj-1', 7, 'task', 'Task A', null, 'ready', 'not_started', null]);
	});

	it('uses an explicit rank verbatim when provided', async () => {
		mockQuery.mockResolvedValue(insertResult({ rank: 2.5 }));

		await createItem('proj-1', { title: 'Ranked', rank: 2.5 });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('MAX(rank)');
		expect(sql).toContain('$9');
		expect(params).toEqual(['proj-1', null, 'epic', 'Ranked', null, 'ready', 'not_started', null, 2.5]);
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
		]);

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(sql).toContain('row_number() OVER (ORDER BY v.ord)');
		expect(sql).toContain('WITH ORDINALITY');
		expect(sql).toContain('UPDATE projects SET item_seq = item_seq + $6');
		expect(params).toEqual(['proj-1', 3, ['task', 'bug'], ['One', 'Two'], [null, 'details'], 2]);
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

		const created = await createItems('proj-1', 3, [{ title: 'One' }, { title: 'Two' }]);

		expect(created.map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('skips the query entirely for an empty batch', async () => {
		const created = await createItems('proj-1', 3, []);

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
		expect(childSql).toContain('ORDER BY rank ASC, created_at ASC, id ASC');
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
