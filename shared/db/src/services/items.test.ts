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
import { createItem, createItems, getItems, moveItem, completeItem, updateItem, startItem, blockItem, unblockItem, deleteItem } from './items.ts';

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
		status_source: 'explicit',
		origin: ORIGIN,
		assignee: null,
		rank: 1,
		due_date: null,
		pr_url: null,
		branch_name: null,
		created_at: new Date('2026-01-01'),
		updated_at: new Date('2026-01-01'),
		checklist: [],
		...overrides,
	} as ItemRow;
}

function insertResult(overrides: Partial<ItemRow> = {}): QueryResult<ItemRow> {
	return { rows: [makeItem(overrides)], rowCount: 1 } as QueryResult<ItemRow>;
}

beforeEach(() => {
	mockQuery.mockReset();
	mockClientQuery.mockReset();
	mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
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
		expect(params).toEqual(['proj-1', null, 'epic', 'Epic A', null, 'ready', 'not_started', ORIGIN_JSON, 'default']);
	});

	it('computes rank inside the INSERT for child items scoped to the parent', async () => {
		mockQuery.mockResolvedValue(insertResult({ parent_id: 'parent-1', number: 7, type: 'task' }));

		await createItem('proj-1', { title: 'Task A', type: 'task', parentNumber: 7, origin: ORIGIN });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('(SELECT COALESCE(MAX(rank), 0) + 1 FROM items WHERE parent_id = (SELECT id FROM parent))');
		expect(params).toEqual(['proj-1', 7, 'task', 'Task A', null, 'ready', 'not_started', ORIGIN_JSON, 'default']);
	});

	it('uses an explicit rank verbatim when provided', async () => {
		mockQuery.mockResolvedValue(insertResult({ rank: 2.5 }));

		await createItem('proj-1', { title: 'Ranked', rank: 2.5, origin: ORIGIN });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('MAX(rank)');
		expect(sql).toContain('$10');
		expect(params).toEqual(['proj-1', null, 'epic', 'Ranked', null, 'ready', 'not_started', ORIGIN_JSON, 'default', 2.5]);
	});

	it('records a named status as explicit and an unnamed one as default, whichever it is', async () => {
		mockQuery.mockResolvedValue(insertResult());

		await createItem('proj-1', { title: 'Named', status: 'ready', origin: ORIGIN });
		await createItem('proj-1', { title: 'Started', status: 'in_progress', origin: ORIGIN });
		await createItem('proj-1', { title: 'Unnamed', origin: ORIGIN });

		expect(mockQuery.mock.calls.map(([, params]) => (params as unknown[])[8])).toEqual(['explicit', 'explicit', 'default']);
		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('INSERT INTO items (project_id, parent_id, type, title, description, status, sub_status, status_source, origin, rank, number)');
		expect(sql).toContain('$7, $9, $8::jsonb');
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
		expect(sql).toContain("v.description, 'ready', 'not_started', 'default', $7::jsonb");
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
		expect(sql).toContain('GROUP BY i.id, p.key, parent.number, parent.title, ob.item_id');
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

		const { items: [item] } = await getItems({ projectId: 'proj-1', includeNotes: true });

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

		const { items: [item] } = await getItems({ projectId: 'proj-1' });

		expect(item!).not.toHaveProperty('notes');
	});

	it('includeChecklist hydrates each item with its scratch todos', async () => {
		const parent = {
			...makeItem({ checklist: [{ id: 'c-1', text: 'wire the drawer', status: 'todo' }] }),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
		};
		mockQuery.mockResolvedValueOnce({ rows: [parent], rowCount: 1 } as never);

		const { items: [item] } = await getItems({ projectId: 'proj-1', includeChecklist: true });

		expect(item!.checklist).toEqual([{ id: 'c-1', text: 'wire the drawer', status: 'todo' }]);
	});

	it('omits the checklist entirely when it was not requested', async () => {
		const parent = {
			...makeItem({ checklist: [{ id: 'c-1', text: 'wire the drawer', status: 'todo' }] }),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
		};
		mockQuery.mockResolvedValueOnce({ rows: [parent], rowCount: 1 } as never);

		const { items: [item] } = await getItems({ projectId: 'proj-1' });

		expect(item!).not.toHaveProperty('checklist');
	});

	it('reports the number of matches past the page as total, from a window count', async () => {
		const row = {
			...makeItem(),
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
			total_count: '842',
		};
		mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 } as never);

		const { items, total } = await getItems({ projectId: 'proj-1', status: 'done', limit: 1 });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('COUNT(*) OVER() as total_count');
		expect(params).toEqual(['proj-1', 'done', 1]);
		expect(items).toHaveLength(1);
		expect(total).toBe(842);
	});

	it('clamps the page size into [1, 5000] and defaults unparseable values', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', limit: 0 });
		await getItems({ projectId: 'proj-1', limit: 99_999 });
		await getItems({ projectId: 'proj-1', limit: '10' as unknown as number });
		await getItems({ projectId: 'proj-1', limit: Number.NaN });

		const limits = mockQuery.mock.calls.map(([, params]) => (params as unknown[]).at(-1));
		expect(limits).toEqual([1, 5000, 10, 25]);
	});

	it('reports total 0 for an empty page', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		const { items, total } = await getItems({ projectId: 'proj-1', status: 'in_review' });

		expect(items).toEqual([]);
		expect(total).toBe(0);
	});

	it('restricts a plain list to top-level items', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', status: 'ready', type: 'task' });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('AND i.parent_id IS NULL');
	});

	it('searches every depth, matching a full item key exactly alongside title and description', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', search: 'sb-12' });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('i.parent_id IS NULL');
		expect(sql).toContain('AND (i.title ILIKE $2 OR i.description ILIKE $2 OR (UPPER(p.key) = $3 AND i.number = $4))');
		expect(params).toEqual(['proj-1', '%sb-12%', 'SB', 12, 25]);
	});

	it('matches a bare number against the item number', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', search: '42' });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('AND (i.title ILIKE $2 OR i.description ILIKE $2 OR i.number = $3)');
		expect(params).toEqual(['proj-1', '%42%', 42, 25]);
	});

	it('emits no key clause for a term that is not a key, including the project key alone', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', search: 'sam' });
		await getItems({ projectId: 'proj-1', search: '-' });
		await getItems({ projectId: 'proj-1', search: 's-42' }); // project key too short
		await getItems({ projectId: 'proj-1', search: '1234567890' }); // number too long

		for (const [sql, params] of mockQuery.mock.calls) {
			expect(sql).toContain('AND (i.title ILIKE $2 OR i.description ILIKE $2)');
			expect(sql).not.toContain('UPPER(p.key)');
			expect(sql).not.toContain('i.number =');
			expect((params as unknown[]).length).toBe(3);
		}
	});

	it('treats a whitespace-only search as no search at all', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', search: '   ' });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('AND i.parent_id IS NULL');
		expect(sql).not.toContain('ILIKE');
		expect(params).toEqual(['proj-1', 25]);
	});

	it('applies status and type to the matched item itself, whatever its parent is doing', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', status: 'ready', type: 'task', search: 'login' });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('i.parent_id IS NULL');
		expect(sql).toContain('AND i.status = $2');
		expect(sql).toContain('AND i.type = $3');
		expect(sql).toContain('i.title ILIKE $4');
		expect(params).toEqual(['proj-1', 'ready', 'task', '%login%', 25]);
	});

	it('escapes ILIKE wildcards so a literal _ or % in a term stays literal', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1', search: 'a_b%c\\d' });

		const [, params] = mockQuery.mock.calls[0]!;
		expect(params![1]).toBe('%a\\_b\\%c\\\\d%');
	});

	it('counts the deep match set in total and gives a matched child its parent key and title', async () => {
		const child = {
			...makeItem({ id: 'child-1', number: 42, parent_id: 'item-1', type: 'task' }),
			parent_number: 7,
			parent_title: 'Auth System',
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
			total_count: '31',
		};
		mockQuery.mockResolvedValueOnce({ rows: [child], rowCount: 1 } as never);

		const { items, total } = await getItems({ projectId: 'proj-1', search: 'login' });

		expect(total).toBe(31);
		expect(items[0]).toMatchObject({ key: 'SB-42', parentKey: 'SB-7', parentTitle: 'Auth System' });
	});

	it('joins the parent title in the same pass as its number, and groups by it', async () => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await getItems({ projectId: 'proj-1' });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('parent.number as parent_number, parent.title as parent_title');
		expect(sql).toContain('LEFT JOIN items parent ON parent.id = i.parent_id');
	});

	it('reports a top-level item as having no parent title', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{
			...makeItem(),
			parent_number: null,
			parent_title: null,
			child_count: '0',
			done_count: '0',
			in_progress_count: '0',
			blocked_count: '0',
			total_count: '1',
		}], rowCount: 1 } as never);

		const { items } = await getItems({ projectId: 'proj-1' });

		expect(items[0]).toMatchObject({ parentKey: null, parentTitle: null });
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
			.mockResolvedValueOnce({ rows: [{ id: 'item-1', parent_id: 'parent-2', previous_parent_id: 'parent-2' }], rowCount: 1 } as never)
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

		expect(mockQuery).toHaveBeenCalledTimes(2);
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
		const [writeSql] = mockClientQuery.mock.calls[0]!;
		expect(writeSql).toContain(`UPDATE items SET`);
		expect(mockClientQuery.mock.calls[1]![0]).toContain('WHERE blocker_item_id = $1');

		const transactions = mockTransaction.mock.calls.length;
		mockQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 } as never);
		await updateItem('proj-1', 1, { title: 'renamed' });
		expect(mockTransaction).toHaveBeenCalledTimes(transactions);
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

describe('parent status rollup', () => {
	const ROLLUP = 'WITH children AS';
	const LOCK = 'SELECT parent_id FROM items WHERE id = $1 FOR NO KEY UPDATE';
	const BUMP = 'UPDATE items SET updated_at = NOW() WHERE id = $1';
	const detailRow = {
		...makeItem({ parent_id: 'epic-1', type: 'task' }),
		blocked: false,
		child_count: '0',
		done_count: '0',
		in_progress_count: '0',
		blocked_count: '0',
	};

	/**
	 * Routes each statement by its SQL, on the pool and transaction clients alike: the
	 * item's own write returns `written`; the lock on a level finds its row and reports
	 * its parent from `parents` (none by default, so the walk ends there); the recompute
	 * of a level listed in `moved` returns that row, and holds still otherwise; everything
	 * else (touches, blockers, worker episodes, the re-read) returns the detail row or nothing.
	 */
	function route(
		written: object | null,
		{ parents = {}, moved = {} }: { parents?: Record<string, string>; moved?: Record<string, Record<string, unknown>> } = {}
	): void {
		const writeResult = { rows: written ? [written] : [], rowCount: written ? 1 : 0 };
		const respond = async (sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
			const levelId = params?.[0] as string;
			if (sql.includes(LOCK)) return { rows: [{ parent_id: parents[levelId] ?? null }], rowCount: 1 };
			if (sql.includes(ROLLUP)) {
				const row = moved[levelId];
				return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
			}
			if (sql.includes(BUMP)) return { rows: [], rowCount: 1 };
			if (sql.includes('item_workers') || sql.includes('item_blockers')) return { rows: [], rowCount: 0 };
			if (/^\s*(UPDATE items|DELETE FROM items|WITH (RECURSIVE )?parent AS)/.test(sql)) return writeResult;
			return { rows: [detailRow], rowCount: 1 };
		};
		mockClientQuery.mockImplementation(respond);
		mockQuery.mockImplementation(respond as never);
	}

	const rollupCalls = (): unknown[][] => mockClientQuery.mock.calls.filter(([sql]) => (sql as string).includes(ROLLUP));
	const workerEnds = (): unknown[][] => [...mockQuery.mock.calls, ...mockClientQuery.mock.calls]
		.filter(([sql]) => (sql as string).includes('UPDATE item_workers'));
	const touched = (): unknown[] => mockClientQuery.mock.calls
		.filter(([sql]) => (sql as string).includes(BUMP))
		.map(([, params]) => (params as unknown[])[0]);

	it('recomputes from the child set: ready rolls up on any started child, in_progress rolls back on none', async () => {
		route({ parent_id: 'epic-1' });

		await startItem('proj-1', 1);

		const [[sql, params]] = rollupCalls() as [[string, unknown[]]];
		expect(sql).toContain(`SET status = CASE WHEN (SELECT started FROM children) THEN 'in_progress' ELSE 'ready' END`);
		expect(sql).toContain(`(status = 'ready' AND status_source <> 'explicit' AND (SELECT started FROM children))`);
		expect(sql).toContain(`(status = 'in_progress' AND NOT (SELECT started FROM children)`);
		expect(params![0]).toBe('epic-1');
	});

	it('counts in_progress, in_review, and done children as started, and blocked as not', async () => {
		route({ parent_id: 'epic-1' });

		await blockItem('proj-1', 1);

		const [[, params]] = rollupCalls() as [[string, unknown[]]];
		expect(params![1]).toEqual(['in_progress', 'in_review', 'done']);
	});

	it("never rolls back a parent whose own sub_status claims it is active", async () => {
		route({ parent_id: 'epic-1' });

		await unblockItem('proj-1', 1);

		const [[sql, params]] = rollupCalls() as [[string, unknown[]]];
		expect(sql).toContain('AND (sub_status IS NULL OR sub_status <> ALL($3::text[]))');
		expect(params![2]).toEqual(['scoping', 'in_development', 'needs_input', 'paused', 'pr_open']);
	});

	it('leaves blocked, in_review, and done parents alone: only ready and in_progress are matched', async () => {
		route({ parent_id: 'epic-1' });

		await updateItem('proj-1', 1, { status: 'ready' });

		const [[sql]] = rollupCalls() as [[string]];
		const where = sql.slice(sql.indexOf('WHERE id = $1'));
		expect(where.match(/status = '(\w+)'/g)).toEqual([`status = 'ready'`, `status = 'in_progress'`]);
	});

	it('a child back to ready rolls the parent back and ends its worker episodes', async () => {
		route({ id: 'item-1', parent_id: 'epic-1', status_changed: true }, { moved: { 'epic-1': { project_id: 'proj-1', number: 7, status: 'ready' } } });

		await updateItem('proj-1', 1, { status: 'ready' });

		expect(mockQuery.mock.calls.filter(([sql]) => (sql as string).includes('UPDATE item_workers')).map(([, params]) => params)).toEqual([['proj-1', 1]]);
		const parentEnd = mockClientQuery.mock.calls.find(([sql]) => (sql as string).includes('UPDATE item_workers'));
		expect(parentEnd?.[1]).toEqual(['proj-1', 7]);
	});

	it('walks to the root, past levels that hold still, following each locked row\'s parent', async () => {
		route({ parent_id: 'task-1' }, {
			parents: { 'task-1': 'epic-1', 'epic-1': 'root-1' },
			moved: { 'task-1': { project_id: 'proj-1', number: 5, status: 'in_progress' } },
		});

		await startItem('proj-1', 9);

		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['task-1', 'epic-1', 'root-1']);
		expect(mockTransaction).toHaveBeenCalledTimes(3);
		expect(workerEnds()).toHaveLength(0);
	});

	it("touches the changed child's parent when its status holds, and nothing above it", async () => {
		route({ parent_id: 'epic-1' }, { parents: { 'epic-1': 'root-1' } });

		await blockItem('proj-1', 1);

		expect(touched()).toEqual(['epic-1']);
	});

	it('a level the rollup moves hands the touch to its own parent', async () => {
		route({ parent_id: 'task-1' }, {
			parents: { 'task-1': 'epic-1', 'epic-1': 'root-1' },
			moved: { 'task-1': { project_id: 'proj-1', number: 5, status: 'in_progress' } },
		});

		await startItem('proj-1', 9);

		// task-1's own recompute wrote its updated_at; epic-1's child counts moved with it.
		expect(touched()).toEqual(['epic-1']);
	});

	it('a touch moves updated_at only, never the status or its source', async () => {
		route({ parent_id: 'epic-1' });

		await deleteItem('proj-1', 1);

		const [bump] = mockClientQuery.mock.calls.filter(([sql]) => (sql as string).includes(BUMP));
		expect(bump![0]).toBe(BUMP);
	});

	it('updateItem touches the parent only when the status actually moved', async () => {
		route({ id: 'item-1', parent_id: 'epic-1', status_changed: false });
		await updateItem('proj-1', 1, { title: 'renamed', status: 'ready' });
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);
		expect(touched()).toEqual([]);

		mockClientQuery.mockClear();
		route({ id: 'item-1', parent_id: 'epic-1', status_changed: true });
		await updateItem('proj-1', 1, { status: 'blocked' });
		expect(touched()).toEqual(['epic-1']);
	});

	it('updateItem reports the move against the row as locked, not the statement snapshot', async () => {
		route({ id: 'item-1', parent_id: 'epic-1', status_changed: false });

		await updateItem('proj-1', 1, { status: 'ready' });

		const [write] = mockQuery.mock.calls.find(([sql]) => (sql as string).startsWith('UPDATE items SET'))!;
		expect(write).toContain('FROM (SELECT id AS previous_id, status AS previous_status FROM items');
		expect(write).toContain('FOR NO KEY UPDATE) previous');
		expect(write).toContain('RETURNING id, parent_id, status IS DISTINCT FROM previous.previous_status AS status_changed');
	});

	it('the parent hears of a sub_status write whose recompute moved the item, even when the write did not', async () => {
		route({ id: 'item-1', parent_id: 'epic-1', status_changed: false }, {
			parents: { 'item-1': 'epic-1' },
			moved: { 'item-1': { project_id: 'proj-1', number: 1, status: 'ready' } },
		});

		await updateItem('proj-1', 1, { subStatus: 'not_started' });

		expect(touched()).toEqual(['epic-1']);
	});

	it('locks the parent row before recomputing, as a separate statement in the same transaction', async () => {
		route({ parent_id: 'epic-1' });

		await startItem('proj-1', 1);

		expect(mockTransaction).toHaveBeenCalledTimes(1);
		const statements = mockClientQuery.mock.calls.map(([sql]) => sql as string);
		const lockAt = statements.findIndex((sql) => sql.includes(LOCK));
		const rollupAt = statements.findIndex((sql) => sql.includes(ROLLUP));
		expect(lockAt).toBeGreaterThanOrEqual(0);
		expect(lockAt).toBeLessThan(rollupAt);
		expect(statements[lockAt]).not.toContain(ROLLUP);
		expect(mockClientQuery.mock.calls[lockAt]![1]).toEqual(['epic-1']);
		expect(mockQuery.mock.calls.some(([sql]) => (sql as string).includes(ROLLUP))).toBe(false);
	});

	it('commits each level before locking the next, so a walk holds one parent lock at a time', async () => {
		route({ parent_id: 'task-1' }, { parents: { 'task-1': 'epic-1' } });

		await startItem('proj-1', 9);

		expect(mockTransaction).toHaveBeenCalledTimes(2);
		const locks = mockClientQuery.mock.calls.filter(([sql]) => (sql as string).includes(LOCK));
		expect(locks.map(([, params]) => (params as unknown[])[0])).toEqual(['task-1', 'epic-1']);
	});

	it('stops the walk without recomputing when the parent is gone by the time it is locked', async () => {
		route({ parent_id: 'epic-1' });
		const respond = mockClientQuery.getMockImplementation()!;
		mockClientQuery.mockImplementation(async (sql: string, params?: unknown[]) => (sql.includes(LOCK) ? { rows: [], rowCount: 0 } : respond(sql, params)));

		await startItem('proj-1', 1);

		expect(rollupCalls()).toHaveLength(0);
	});

	it('completing a child recomputes its parent after the completion transaction', async () => {
		route({ id: 'item-1', parent_id: 'epic-1' });

		await completeItem('proj-1', 1);

		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);
	});

	it('updateItem recomputes only on a status or sub_status write', async () => {
		route({ id: 'item-1', parent_id: 'epic-1' }, { parents: { 'item-1': 'epic-1' } });

		await updateItem('proj-1', 1, { title: 'renamed' });
		expect(rollupCalls()).toHaveLength(0);

		// The item itself first (its sub_status is an input), then the parent its derived status moved.
		await updateItem('proj-1', 1, { subStatus: 'in_development' });
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['item-1', 'epic-1']);
	});

	it('only a status the rollup or a sub_status set is demoted; an explicit one stays', async () => {
		route({ parent_id: 'epic-1' });

		await deleteItem('proj-1', 1);

		const [[sql]] = rollupCalls() as [[string]];
		const demotion = sql.slice(sql.indexOf(`(status = 'in_progress'`));
		expect(demotion).toContain(`AND status_source IN ('rollup', 'sub_status')`);
		expect(sql.slice(0, sql.indexOf(`(status = 'in_progress'`))).not.toContain('status_source IN');
	});

	it('records every status the rollup moves as its own', async () => {
		route({ parent_id: 'epic-1' });

		await startItem('proj-1', 1);

		const [[sql]] = rollupCalls() as [[string]];
		expect(sql).toContain(`status_source = 'rollup', updated_at = NOW()`);
	});

	it('recomputes a childless item like any other: nothing can promote it, and only a derived in_progress falls back', async () => {
		route({ parent_id: 'epic-1' });

		await deleteItem('proj-1', 1);

		const [[sql, params]] = rollupCalls() as [[string, unknown[]]];
		expect(sql).not.toContain('has_children');
		expect(params).toHaveLength(3);
	});

	it('a sub_status that derives no status recomputes the item itself, then walks up from it', async () => {
		route({ id: 'item-1', parent_id: 'epic-1' }, {
			parents: { 'item-1': 'epic-1' },
			moved: { 'item-1': { project_id: 'proj-1', number: 1, status: 'ready' } },
		});

		await updateItem('proj-1', 1, { subStatus: 'not_started' });

		const rollups = rollupCalls() as Array<[string, unknown[]]>;
		expect(rollups.map(([, params]) => params[0])).toEqual(['item-1', 'epic-1']);
		expect(mockTransaction).toHaveBeenCalledTimes(2);
		const locks = mockClientQuery.mock.calls.filter(([sql]) => (sql as string).includes(LOCK));
		expect(locks.map(([, params]) => (params as unknown[])[0])).toEqual(['item-1', 'epic-1']);
		expect(workerEnds().map(([, params]) => params)).toEqual([['proj-1', 1]]);
	});

	it('a status sent alongside a sub_status still recomputes the item, then its parent', async () => {
		// The web client PUTs the whole model, so a sub_status change always carries the
		// current status too; that echo must not skip the item's own recompute.
		route({ id: 'item-1', parent_id: 'epic-1' }, { parents: { 'item-1': 'epic-1' } });

		await updateItem('proj-1', 1, { status: 'in_progress', subStatus: 'not_started' });

		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['item-1', 'epic-1']);
	});

	it('a top-level item has no parent to recompute', async () => {
		route({ parent_id: null });

		await startItem('proj-1', 1);
		await updateItem('proj-1', 1, { status: 'ready' });

		expect(rollupCalls()).toHaveLength(0);
	});

	it('deleting a child recomputes the parent it left', async () => {
		route({ parent_id: 'epic-1' });

		expect(await deleteItem('proj-1', 1)).toBe(true);

		const [deleteSql] = mockQuery.mock.calls[0]!;
		expect(deleteSql).toContain('RETURNING parent_id');
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);
	});

	it('deleting nothing recomputes nothing', async () => {
		route(null);

		expect(await deleteItem('proj-1', 1)).toBe(false);
		expect(rollupCalls()).toHaveLength(0);
	});

	it('moving a child recomputes the parent it left and the one it joined', async () => {
		route({ id: 'item-1', parent_id: 'epic-2', previous_parent_id: 'epic-1' });

		await moveItem('proj-1', 1, 2);

		const [moveSql] = mockQuery.mock.calls[0]!;
		expect(moveSql).toContain('previous AS (\n\t\t\tSELECT parent_id FROM items WHERE number = $2 AND project_id = $3');
		expect(moveSql).toContain('(SELECT parent_id FROM previous) AS previous_parent_id');
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1', 'epic-2']);
		expect(touched()).toEqual(['epic-1', 'epic-2']);
	});

	it('promoting a child to top-level recomputes only the parent it left', async () => {
		route({ id: 'item-1', parent_id: null, previous_parent_id: 'epic-1' });

		await moveItem('proj-1', 1, null);

		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);
	});

	it('creating a child recomputes its parent whatever the child\'s status', async () => {
		route(makeItem({ parent_id: 'epic-1', status: 'in_progress', sub_status: 'in_development' }));
		await createItem('proj-1', { title: 'Task', type: 'task', parentNumber: 7, status: 'in_progress', origin: ORIGIN });
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);

		mockClientQuery.mockClear();
		route(makeItem({ parent_id: 'epic-1' }));
		await createItem('proj-1', { title: 'Task', type: 'task', parentNumber: 7, origin: ORIGIN });
		const [[sql, params]] = rollupCalls() as [[string, unknown[]]];
		expect(sql).toContain(`(status = 'in_progress' AND NOT (SELECT started FROM children)`);
		expect(params![0]).toBe('epic-1');
	});

	it('creating a top-level item recomputes nothing', async () => {
		route(makeItem({ parent_id: null }));

		await createItem('proj-1', { title: 'Epic', origin: ORIGIN });

		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it('a bulk create recomputes its parent once for the whole batch, after the insert', async () => {
		route(null);
		mockQuery.mockResolvedValueOnce({
			rows: [
				makeItem({ id: 'a', parent_id: 'epic-1', rank: 1 }),
				makeItem({ id: 'b', parent_id: 'epic-1', rank: 2 }),
				makeItem({ id: 'c', parent_id: 'epic-1', rank: 3 }),
			],
			rowCount: 3,
		} as never);

		await createItems('proj-1', 7, [{ title: 'A' }, { title: 'B' }, { title: 'C' }], ORIGIN);

		expect(mockTransaction).toHaveBeenCalledTimes(1);
		expect(rollupCalls().map(([, params]) => (params as unknown[])[0])).toEqual(['epic-1']);
		expect(touched()).toEqual(['epic-1']);
		expect(mockQuery.mock.invocationCallOrder[0]!).toBeLessThan(mockClientQuery.mock.invocationCallOrder[0]!);
	});
});

describe('status source', () => {
	const detailRow = {
		...makeItem(),
		blocked: false,
		child_count: '0',
		done_count: '0',
		in_progress_count: '0',
		blocked_count: '0',
	};

	/** The item's own UPDATE and its params, by position of the status_source assignment. */
	function sourceWrite(): { sql: string; status: unknown; source: unknown } {
		const call = [...mockQuery.mock.calls, ...mockClientQuery.mock.calls]
			.find(([sql]) => (sql as string).startsWith('UPDATE items SET'))!;
		const sql = call[0] as string;
		const params = call[1] as unknown[];
		const match = /status_source = CASE WHEN status IS DISTINCT FROM \$(\d+) THEN \$(\d+) ELSE status_source END/.exec(sql);
		expect(match).not.toBeNull();
		return { sql, status: params[Number(match![1]) - 1], source: params[Number(match![2]) - 1] };
	}

	beforeEach(() => {
		mockQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 } as never);
		mockClientQuery.mockResolvedValue({ rows: [detailRow], rowCount: 1 });
	});

	it('a drag (status moved, the model echoing sub_status not_started) is explicit', async () => {
		await updateItem('proj-1', 1, { status: 'in_progress', subStatus: 'not_started', rank: 2 });

		expect(sourceWrite()).toMatchObject({ status: 'in_progress', source: 'explicit' });
	});

	it('a bare status write is explicit', async () => {
		await updateItem('proj-1', 1, { status: 'in_progress' });

		expect(sourceWrite()).toMatchObject({ status: 'in_progress', source: 'explicit' });
	});

	it('a status derived from sub_status is recorded as the sub_status\'s', async () => {
		await updateItem('proj-1', 1, { subStatus: 'in_development' });

		expect(sourceWrite()).toMatchObject({ status: 'in_progress', source: 'sub_status' });
	});

	it('a status that matches what the sent sub_status derives is the sub_status\'s, as the drawer sends it', async () => {
		await updateItem('proj-1', 1, { status: 'in_progress', subStatus: 'scoping' });

		expect(sourceWrite()).toMatchObject({ status: 'in_progress', source: 'sub_status' });
	});

	it('a named status that differs from the derived one wins, and is explicit', async () => {
		await updateItem('proj-1', 1, { status: 'blocked', subStatus: 'in_development' });

		expect(sourceWrite()).toMatchObject({ status: 'blocked', source: 'explicit' });
	});

	it('restating the current status keeps its source: the CASE only fires when the value moves', async () => {
		await updateItem('proj-1', 1, { title: 'renamed', status: 'in_progress' });

		const { sql } = sourceWrite();
		expect(sql).toMatch(/ELSE status_source END/);
	});

	it('writes no source when no status is written', async () => {
		await updateItem('proj-1', 1, { title: 'renamed' });

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).not.toContain('status_source');
	});

	it('the lifecycle routes are explicit, except the Ready an unblock restores', async () => {
		mockClientQuery.mockResolvedValue({ rows: [{ id: 'item-1', parent_id: null }], rowCount: 1 });
		mockQuery.mockImplementation((async (sql: string) => (
			sql.startsWith('UPDATE items') ? { rows: [{ parent_id: null }], rowCount: 1 } : { rows: [detailRow], rowCount: 1 }
		)) as never);

		await startItem('proj-1', 1);
		await completeItem('proj-1', 1);
		await blockItem('proj-1', 1);
		await unblockItem('proj-1', 1);

		const writes = [...mockQuery.mock.calls, ...mockClientQuery.mock.calls]
			.map(([sql]) => sql as string)
			.filter((sql) => sql.startsWith('UPDATE items SET status'));
		expect(writes).toHaveLength(4);
		const unblock = writes.find((sql) => sql.startsWith(`UPDATE items SET status = 'ready'`))!;
		expect(unblock).toContain(`status_source = CASE WHEN status = 'blocked' THEN 'default' ELSE 'explicit' END`);
		for (const sql of writes.filter((w) => w !== unblock)) expect(sql).toContain(`status_source = 'explicit'`);
	});
});
