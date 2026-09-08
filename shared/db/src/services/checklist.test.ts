/**
 * Checklist service tests — entry-level writes must rewrite only the element
 * they matched, and the cap must hold inside the statement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

import { query } from '../index.ts';
import {
	getChecklist,
	setChecklist,
	addChecklistEntry,
	updateChecklistEntry,
	removeChecklistEntry,
	ChecklistValidationError,
	MAX_CHECKLIST_ENTRIES,
	MAX_CHECKLIST_TEXT,
} from './checklist.ts';

const mockQuery = vi.mocked(query);

beforeEach(() => {
	mockQuery.mockReset();
});

describe('getChecklist', () => {
	it('returns null for an item that is not in the project', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await getChecklist('proj-1', 1)).toBeNull();
	});

	it('returns the stored array', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ checklist: [{ id: 'a', text: 'one', status: 'todo' }] }], rowCount: 1 } as never);

		expect(await getChecklist('proj-1', 1)).toEqual([{ id: 'a', text: 'one', status: 'todo' }]);
	});
});

describe('addChecklistEntry', () => {
	it('appends in one statement and enforces the cap inside the WHERE', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ entry: { id: 'e-1', text: 'ship it', status: 'todo' } }], rowCount: 1 } as never);

		const entry = await addChecklistEntry('proj-1', 7, '  ship it  ');

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('SET checklist = checklist || jsonb_build_array(');
		expect(sql).toContain("'status', 'todo'");
		expect(sql).toMatch(/WHERE number = \$1 AND project_id = \$2\s+AND jsonb_array_length\(checklist\) < \$4/);
		expect(sql).toContain('RETURNING checklist -> -1 AS entry');
		expect(params).toEqual([7, 'proj-1', 'ship it', MAX_CHECKLIST_ENTRIES]);
		expect(entry).toEqual({ id: 'e-1', text: 'ship it', status: 'todo' });
	});

	it('diagnoses zero rows as a full list when the item exists', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 } as never);

		await expect(addChecklistEntry('proj-1', 7, 'one more')).rejects.toThrow(ChecklistValidationError);
	});

	it('diagnoses zero rows as a missing item when the item is gone', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await addChecklistEntry('proj-1', 7, 'one more')).toBeNull();
	});

	it('rejects empty text before touching the database', async () => {
		await expect(addChecklistEntry('proj-1', 7, '   ')).rejects.toThrow(ChecklistValidationError);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe('updateChecklistEntry', () => {
	it('rewrites only the matched element, guarded on the entry having existed', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ entry: { id: 'e-1', text: 'one', status: 'done' } }], rowCount: 1 } as never);

		await updateChecklistEntry('proj-1', 7, 'e-1', { status: 'done' });

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain("CASE WHEN e->>'id' = $3 THEN e || $4::jsonb ELSE e END");
		expect(sql).toContain('jsonb_array_elements(checklist) WITH ORDINALITY AS t(e, ord)');
		expect(sql).toContain("AND checklist @> jsonb_build_array(jsonb_build_object('id', $3::text))");
		expect(params).toEqual([7, 'proj-1', 'e-1', JSON.stringify({ status: 'done' })]);
	});

	it('patches only the fields it was given, with the text trimmed', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ entry: { id: 'e-1', text: 'renamed', status: 'todo' } }], rowCount: 1 } as never);

		await updateChecklistEntry('proj-1', 7, 'e-1', { text: '  renamed  ' });

		expect(mockQuery.mock.calls[0]![1]![3]).toBe(JSON.stringify({ text: 'renamed' }));
	});

	it('rejects a status outside the union before touching the database', async () => {
		await expect(updateChecklistEntry('proj-1', 7, 'e-1', { status: 'blocked' as never })).rejects.toThrow(
			ChecklistValidationError
		);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it('returns null when no entry matched', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await updateChecklistEntry('proj-1', 7, 'missing', { status: 'done' })).toBeNull();
	});
});

describe('removeChecklistEntry', () => {
	it('rebuilds the array without the entry, in order, guarded on it having existed', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 'item-1' }], rowCount: 1 } as never);

		expect(await removeChecklistEntry('proj-1', 7, 'e-1')).toBe(true);

		const [sql] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('jsonb_agg(e ORDER BY ord)');
		expect(sql).toContain("WHERE e->>'id' <> $3");
		expect(sql).toContain("AND checklist @> jsonb_build_array(jsonb_build_object('id', $3::text))");
	});

	it('reports false when nothing matched', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await removeChecklistEntry('proj-1', 7, 'e-1')).toBe(false);
	});
});

describe('setChecklist', () => {
	it('mints ids for entries lacking one and preserves supplied ids', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ checklist: [] }], rowCount: 1 } as never);

		await setChecklist('proj-1', 7, [{ id: 'kept-1', text: 'first', status: 'done' }, { text: '  second  ' }]);

		const written = JSON.parse(mockQuery.mock.calls[0]![1]![2] as string) as Array<{ id: string; text: string; status: string }>;
		expect(written[0]).toEqual({ id: 'kept-1', text: 'first', status: 'done' });
		expect(written[1]!.text).toBe('second');
		expect(written[1]!.status).toBe('todo');
		expect(written[1]!.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('returns null when the item is not in the project', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		expect(await setChecklist('proj-1', 7, [])).toBeNull();
	});

	it('rejects a non-array, bad text, an unknown status, and an over-long list', async () => {
		await expect(setChecklist('proj-1', 7, 'nope' as never)).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [{ text: '' }])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [{ text: '   ' }])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [{ text: 'x'.repeat(MAX_CHECKLIST_TEXT + 1) }])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [{ text: 'one', status: 'blocked' as never }])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [{ text: 'one', status: true as never }])).rejects.toThrow(ChecklistValidationError);
		await expect(
			setChecklist('proj-1', 7, Array.from({ length: MAX_CHECKLIST_ENTRIES + 1 }, () => ({ text: 'x' })))
		).rejects.toThrow(ChecklistValidationError);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	// A null or a bare string used to reach entry.text as a TypeError, escaping
	// ChecklistValidationError and surfacing as a 500 rather than a 400.
	it('rejects an entry that is not an object', async () => {
		await expect(setChecklist('proj-1', 7, [null as never])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, ['just text' as never])).rejects.toThrow(ChecklistValidationError);
		await expect(setChecklist('proj-1', 7, [['nested'] as never])).rejects.toThrow(ChecklistValidationError);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	// Duplicate ids make every entry-level statement ambiguous, and the patch's
	// RETURNING subquery errors outright when two rows share the id it selects on.
	it('rejects duplicate supplied ids', async () => {
		await expect(
			setChecklist('proj-1', 7, [{ id: 'c1', text: 'one' }, { id: 'c1', text: 'two' }])
		).rejects.toThrow(ChecklistValidationError);
		expect(mockQuery).not.toHaveBeenCalled();
	});
});
