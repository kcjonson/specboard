/**
 * Item service tests — rank assignment and stable ordering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Item } from '../types.ts';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
}));

import { query } from '../index.ts';
import { createItem, createItems, getItems, moveItem } from './items.ts';

const mockQuery = vi.mocked(query);

function makeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 'item-1',
		project_id: 'proj-1',
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
	} as Item;
}

function insertResult(overrides: Partial<Item> = {}) {
	return { rows: [makeItem(overrides)], rowCount: 1 } as never;
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
		expect(params).toEqual(['proj-1', null, 'epic', 'Epic A', null, 'ready', 'not_started', null]);
	});

	it('computes rank inside the INSERT for child items scoped to the parent', async () => {
		mockQuery.mockResolvedValue(insertResult({ parent_id: 'parent-1', type: 'task' }));

		await createItem('proj-1', { title: 'Task A', type: 'task', parentId: 'parent-1' });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = $2)');
		expect(params).toEqual(['proj-1', 'parent-1', 'task', 'Task A', null, 'ready', 'not_started', null]);
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
	it('inserts each row with an inline MAX(rank) subquery, one statement per item', async () => {
		mockQuery
			.mockResolvedValueOnce(insertResult({ id: 'a', parent_id: 'parent-1', rank: 1 }))
			.mockResolvedValueOnce(insertResult({ id: 'b', parent_id: 'parent-1', rank: 2 }));

		const created = await createItems('proj-1', 'parent-1', [
			{ title: 'One' },
			{ title: 'Two', type: 'bug' },
		]);

		expect(mockQuery).toHaveBeenCalledTimes(2);
		for (const [sql] of mockQuery.mock.calls) {
			expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = $2)');
		}
		expect(mockQuery.mock.calls[0]![1]).toEqual(['proj-1', 'parent-1', 'task', 'One', null]);
		expect(mockQuery.mock.calls[1]![1]).toEqual(['proj-1', 'parent-1', 'bug', 'Two', null]);
		expect(created.map((c) => c.id)).toEqual(['a', 'b']);
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

		await moveItem('proj-1', 'item-1', 'parent-2');

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('UPDATE items SET parent_id = $1');
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = $1)');
		expect(params).toEqual(['parent-2', 'item-1', 'proj-1']);
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

		await moveItem('proj-1', 'item-1', null);

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE project_id = $3 AND parent_id IS NULL)');
		expect(params).toEqual([null, 'item-1', 'proj-1']);
	});
});
