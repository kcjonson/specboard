/**
 * Item note service tests — validation, project scoping, actor serialization,
 * ordering, grouping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Actor } from '../types.ts';

const { mockClientQuery } = vi.hoisted(() => ({ mockClientQuery: vi.fn() }));

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

import { query } from '../index.ts';
import { listItemNotes, addItemNote, listNotesByItems, NoteValidationError, MAX_NOTE_LENGTH } from './notes.ts';

const mockQuery = vi.mocked(query);

const ACTOR: Actor = { type: 'user', userId: 'user-1' };

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'note-1',
		item_id: 'item-1',
		note: 'did a thing',
		actor: null,
		created_at: new Date('2026-01-01'),
		...overrides,
	};
}

beforeEach(() => {
	mockQuery.mockReset();
	mockClientQuery.mockReset();
});

describe('listItemNotes', () => {
	it('reads the item-scoped log newest first and surfaces a null actor as null', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [makeRow()], rowCount: 1 } as never);

		const notes = await listItemNotes('proj-1', 7);

		const [lookupSql, lookupParams] = mockQuery.mock.calls[0]!;
		expect(lookupSql).toContain('FROM items WHERE number = $1 AND project_id = $2');
		expect(lookupParams).toEqual([7, 'proj-1']);

		const [sql, params] = mockQuery.mock.calls[1]!;
		expect(sql).toContain('FROM item_notes n');
		expect(sql).toContain('i.project_id = $2');
		expect(sql).toContain('ORDER BY n.created_at DESC');
		expect(params).toEqual([7, 'proj-1']);
		expect(notes).toEqual([{ id: 'note-1', note: 'did a thing', actor: null, createdAt: new Date('2026-01-01') }]);
	});

	it('returns null when the item is not in the project', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await listItemNotes('proj-1', 404)).toBeNull();
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});
});

describe('addItemNote', () => {
	it('serializes the actor to JSON, scopes the insert to the project, and bumps the item', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [makeRow({ actor: ACTOR })], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		const note = await addItemNote('proj-1', 7, 'did a thing', ACTOR);

		const [sql, params] = mockClientQuery.mock.calls[0]!;
		expect(sql).toContain('INSERT INTO item_notes (item_id, note, actor)');
		expect(sql).toContain('project_id = $2');
		expect(params).toEqual([7, 'proj-1', 'did a thing', JSON.stringify(ACTOR)]);

		const [bumpSql, bumpParams] = mockClientQuery.mock.calls[1]!;
		expect(bumpSql).toContain('UPDATE items SET updated_at = NOW()');
		expect(bumpParams).toEqual(['item-1']);

		expect(note).toEqual({ id: 'note-1', note: 'did a thing', actor: ACTOR, createdAt: new Date('2026-01-01') });
	});

	it('writes a NULL actor when none is supplied', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [makeRow()], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		await addItemNote('proj-1', 7, 'did a thing');

		const [, params] = mockClientQuery.mock.calls[0]!;
		expect(params![3]).toBeNull();
	});

	it('trims the note before writing it', async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [makeRow()], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		await addItemNote('proj-1', 7, '  did a thing \n');

		const [, params] = mockClientQuery.mock.calls[0]!;
		expect(params![2]).toBe('did a thing');
	});

	it('rejects empty and over-long text without touching the database', async () => {
		await expect(addItemNote('proj-1', 7, '   ')).rejects.toThrow(NoteValidationError);
		await expect(addItemNote('proj-1', 7, 'x'.repeat(MAX_NOTE_LENGTH + 1))).rejects.toThrow(NoteValidationError);
		expect(mockClientQuery).not.toHaveBeenCalled();
	});

	it('returns null when the item is not in the project', async () => {
		mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		expect(await addItemNote('proj-1', 404, 'orphan', ACTOR)).toBeNull();
		expect(mockClientQuery).toHaveBeenCalledTimes(1);
	});
});

describe('listNotesByItems', () => {
	it('groups by item, preserving the newest-first order within each item', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [
			makeRow({ id: 'a2', item_id: 'item-1', note: 'newer', created_at: new Date('2026-01-02') }),
			makeRow({ id: 'a1', item_id: 'item-1', note: 'older', created_at: new Date('2026-01-01') }),
			makeRow({ id: 'b1', item_id: 'item-2', note: 'other item', actor: ACTOR }),
		], rowCount: 3 } as never);

		const byItem = await listNotesByItems(['item-1', 'item-2']);

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('ORDER BY created_at DESC');
		expect(params).toEqual([['item-1', 'item-2']]);
		expect(byItem.get('item-1')!.map((n) => n.id)).toEqual(['a2', 'a1']);
		expect(byItem.get('item-2')![0]!.actor).toEqual(ACTOR);
		expect(byItem.get('item-3')).toBeUndefined();
	});

	it('returns an empty map for an empty id list', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await listNotesByItems([])).toEqual(new Map());
	});
});
