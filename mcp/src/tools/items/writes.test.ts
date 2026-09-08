/**
 * update_item handler tests — the status shortcuts must not swallow the other
 * fields sent alongside a status change, and `note` must reach the activity log
 * on every path that accepts one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/db', () => ({
	createItem: vi.fn(),
	createItems: vi.fn(),
	updateItem: vi.fn(async () => ({ key: 'SB-1', title: 'T', status: 'ready', subStatus: null, branchName: null, prUrl: null, blocked: false })),
	moveItem: vi.fn(async () => ({ key: 'SB-1', parentKey: 'SB-9' })),
	wouldCreateCycle: vi.fn(async () => false),
	deleteItem: vi.fn(),
	startItem: vi.fn(async () => ({ key: 'SB-1', status: 'in_progress' })),
	completeItem: vi.fn(async () => ({ key: 'SB-1', status: 'done' })),
	blockItem: vi.fn(async () => ({ key: 'SB-1', status: 'blocked' })),
	unblockItem: vi.fn(async () => ({ key: 'SB-1', status: 'ready' })),
	addItemNote: vi.fn(async () => ({ id: 'n-1', note: 'entry', actor: null, createdAt: new Date() })),
	verifyItemOwnership: vi.fn(async () => true),
	setSpecs: vi.fn(),
	setBlockers: vi.fn(async () => []),
	setChecklist: vi.fn(async () => [{ id: 'c-1', text: 'draft the migration', status: 'todo' }]),
	getChecklist: vi.fn(async () => [{ id: 'c-1', text: 'draft the migration', status: 'done' }]),
	updateChecklistEntry: vi.fn(async () => ({ id: 'c-1', text: 'draft the migration', status: 'done' })),
	recordWorkerActivity: vi.fn(),
	SpecValidationError: class extends Error {},
	NoteValidationError: class extends Error {},
	BlockerValidationError: class extends Error {},
	BlockerConflictError: class extends Error {},
	BlockerTargetError: class extends Error {},
	ChecklistValidationError: class extends Error {},
	ParentItemNotFoundError: class extends Error {},
	DiscoveredFromNotFoundError: class extends Error {},
	ItemCycleError: class extends Error {},
}));

import { updateItem as updateItemService, moveItem, startItem, completeItem, blockItem, unblockItem, addItemNote, setChecklist, getChecklist, updateChecklistEntry, NoteValidationError } from '@specboard/db';
import type { AgentActor } from '@specboard/db';
import { updateItem } from './writes.ts';

const PROJECT = { id: 'proj-1', slug: 'specboard', key: 'SB' };
const ACTOR: AgentActor = { type: 'agent', userId: 'user-1', clientId: 'client-1', sessionId: 's-1' };

const mockUpdate = vi.mocked(updateItemService);
const mockAddNote = vi.mocked(addItemNote);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('update_item status shortcuts', () => {
	it('appends a note sent with status in_progress', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'in_progress', note: 'picked this up' }, ACTOR);

		expect(vi.mocked(startItem)).toHaveBeenCalled();
		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'picked this up', ACTOR);
	});

	it('names the shortcut status when sub_status rides along, so nothing is derived', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'in_progress', sub_status: 'complete' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { subStatus: 'complete', status: 'in_progress' });
		expect(vi.mocked(startItem)).toHaveBeenCalled();
	});

	it('applies branch_name sent with status in_progress', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'in_progress', branch_name: 'feat/x' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { branchName: 'feat/x' });
		expect(vi.mocked(startItem)).toHaveBeenCalledWith('proj-1', 1);
	});

	it('applies pr_url and appends the note sent with status done', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'done', note: 'merged #1', pr_url: 'https://x/1' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { prUrl: 'https://x/1' });
		expect(vi.mocked(completeItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'merged #1', ACTOR);
	});

	it('applies branch_name and appends the note sent with status blocked', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'blocked', note: 'needs API key', branch_name: 'fix/auth' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { branchName: 'fix/auth' });
		expect(vi.mocked(blockItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'needs API key', ACTOR);
	});

	it('refuses status blocked with neither a note nor blockers', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', status: 'blocked' }, ACTOR);

		expect(result.isError).toBe(true);
		expect(vi.mocked(blockItem)).not.toHaveBeenCalled();
	});

	it('allows status blocked when blockers say why and no note is given', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', status: 'blocked', blockers: [{ text: 'waiting on design' }] }, ACTOR);

		expect(result.isError).toBeUndefined();
		expect(vi.mocked(blockItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(mockAddNote).not.toHaveBeenCalled();
	});

	it('falls through to the general update when status ready carries other fields', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'ready', title: 'Renamed' }, ACTOR);

		expect(vi.mocked(unblockItem)).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { title: 'Renamed', status: 'ready' });
	});

	it('falls through to the general update when status ready carries a note', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'ready', note: 'unblocked by hand' }, ACTOR);

		expect(vi.mocked(unblockItem)).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { status: 'ready' });
		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'unblocked by hand', ACTOR);
	});

	it('still takes the bare unblock shortcut for a plain status ready', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'ready' }, ACTOR);

		expect(vi.mocked(unblockItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});

describe('update_item move', () => {
	const payload = (result: Awaited<ReturnType<typeof updateItem>>): { updated: Record<string, unknown>; message: string } =>
		JSON.parse(result.content[0]!.text);

	it('applies the fields sent alongside a move', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', title: 'Renamed', pr_url: 'https://x/1' }, ACTOR);

		expect(vi.mocked(moveItem)).toHaveBeenCalledWith('proj-1', 1, 9);
		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { title: 'Renamed', prUrl: 'https://x/1' });
		expect(payload(result).updated).toMatchObject({ parentKey: 'SB-9' });
	});

	it('completes the item when status done rides along with a move', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', status: 'done' }, ACTOR);

		expect(vi.mocked(moveItem)).toHaveBeenCalledWith('proj-1', 1, 9);
		expect(vi.mocked(completeItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(payload(result).updated).toMatchObject({ status: 'done', parentKey: 'SB-9' });
	});

	it('refuses status blocked with a move but neither a note nor blockers', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', status: 'blocked' }, ACTOR);

		expect(result.isError).toBe(true);
		expect(vi.mocked(moveItem)).not.toHaveBeenCalled();
		expect(vi.mocked(blockItem)).not.toHaveBeenCalled();
	});

	it('reports a bare move without touching the update or note services', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9' }, ACTOR);

		expect(payload(result).message).toBe('Item moved');
		expect(mockUpdate).not.toHaveBeenCalled();
		expect(mockAddNote).not.toHaveBeenCalled();
	});
});

describe('update_item note handling', () => {
	it('appends the note on a move', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', note: 'moved under the auth epic' }, ACTOR);

		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'moved under the auth epic', ACTOR);
	});

	it('appends the note on a general update', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', note: '  spec approved  ' }, ACTOR);

		expect(mockAddNote).toHaveBeenCalledWith('proj-1', 1, 'spec approved', ACTOR);
	});

	it('ignores a whitespace-only note rather than erroring', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', title: 'T', note: '   ' }, ACTOR);

		expect(result.isError).toBeUndefined();
		expect(mockAddNote).not.toHaveBeenCalled();
	});

	it('reports an over-long note as an error, using the service message', async () => {
		mockAddNote.mockRejectedValueOnce(new NoteValidationError('Note text must be at most 10000 characters'));

		const result = await updateItem(PROJECT, { item_key: 'SB-1', title: 'T', note: 'x'.repeat(10001) }, ACTOR);

		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toBe('Note text must be at most 10000 characters');
	});
});

describe('update_item checklist', () => {
	const payload = (result: Awaited<ReturnType<typeof updateItem>>): { updated: Record<string, unknown> } =>
		JSON.parse(result.content[0]!.text);

	const CHECKLIST = [{ text: 'draft the migration' }, { text: 'wire the drawer', status: 'done' }];

	it('replaces the checklist on a general update', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', title: 'Renamed', checklist: CHECKLIST }, ACTOR);

		expect(vi.mocked(setChecklist)).toHaveBeenCalledWith('proj-1', 1, CHECKLIST);
		expect(payload(result).updated).toMatchObject({ checklist: [{ id: 'c-1', text: 'draft the migration', status: 'todo' }] });
	});

	it.each([
		['in_progress', {}],
		['done', {}],
		['blocked', { note: 'waiting on review' }],
		['ready', {}],
	])('replaces the checklist alongside status %s', async (status, extra) => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', status, checklist: CHECKLIST, ...extra }, ACTOR);

		expect(vi.mocked(setChecklist)).toHaveBeenCalledWith('proj-1', 1, CHECKLIST);
		expect(payload(result).updated).toMatchObject({ checklist: [{ id: 'c-1', text: 'draft the migration', status: 'todo' }] });
	});

	it('does not take the bare-move early return when a checklist rides along', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', checklist: CHECKLIST }, ACTOR);

		expect(vi.mocked(moveItem)).toHaveBeenCalledWith('proj-1', 1, 9);
		expect(vi.mocked(setChecklist)).toHaveBeenCalledWith('proj-1', 1, CHECKLIST);
	});

	it('leaves the checklist alone when the arg is absent', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', title: 'Renamed' }, ACTOR);

		expect(vi.mocked(setChecklist)).not.toHaveBeenCalled();
		expect(vi.mocked(updateChecklistEntry)).not.toHaveBeenCalled();
	});
});

describe('update_item checklist_status', () => {
	const payload = (result: Awaited<ReturnType<typeof updateItem>>): { updated: Record<string, unknown> } =>
		JSON.parse(result.content[0]!.text);

	it('patches each entry by id and reports the refreshed checklist', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', checklist_status: { 'c-1': 'done', 'c-2': 'todo' } }, ACTOR);

		expect(vi.mocked(updateChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, 'c-1', { status: 'done' });
		expect(vi.mocked(updateChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, 'c-2', { status: 'todo' });
		expect(vi.mocked(setChecklist)).not.toHaveBeenCalled();
		expect(payload(result).updated).toMatchObject({ checklist: [{ id: 'c-1', status: 'done' }] });
	});

	it.each([
		['in_progress', {}],
		['done', {}],
		['blocked', { note: 'waiting on review' }],
		['ready', {}],
	])('patches statuses alongside status %s', async (status, extra) => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', status, checklist_status: { 'c-1': 'done' }, ...extra }, ACTOR);

		expect(vi.mocked(updateChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, 'c-1', { status: 'done' });
		expect(payload(result).updated).toMatchObject({ checklist: [{ id: 'c-1', status: 'done' }] });
	});

	it('does not take the bare-move early return when checklist_status rides along', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', parent_key: 'SB-9', checklist_status: { 'c-1': 'done' } }, ACTOR);

		expect(vi.mocked(moveItem)).toHaveBeenCalledWith('proj-1', 1, 9);
		expect(vi.mocked(updateChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, 'c-1', { status: 'done' });
	});

	it('replaces the list before patching it, so the ticks survive', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', checklist: [{ text: 'draft the migration' }], checklist_status: { 'c-1': 'done' } }, ACTOR);

		const replaced = vi.mocked(setChecklist).mock.invocationCallOrder[0]!;
		const patched = vi.mocked(updateChecklistEntry).mock.invocationCallOrder[0]!;
		expect(replaced).toBeLessThan(patched);
	});

	it('errors on an unknown entry id, naming it', async () => {
		vi.mocked(updateChecklistEntry).mockResolvedValueOnce(null);

		const result = await updateItem(PROJECT, { item_key: 'SB-1', checklist_status: { 'gone-1': 'done' } }, ACTOR);

		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('gone-1');
		expect(vi.mocked(getChecklist)).not.toHaveBeenCalled();
	});

	it('rejects a checklist_status that is not an id-to-status object', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', checklist_status: ['c-1'] }, ACTOR);

		expect(result.isError).toBe(true);
		expect(vi.mocked(updateChecklistEntry)).not.toHaveBeenCalled();
	});

	// A non-array checklist used to fall through as a no-op, reporting success
	// while dropping the write entirely.
	it('rejects a checklist that is not an array', async () => {
		const result = await updateItem(PROJECT, { item_key: 'SB-1', checklist: 'tidy up' }, ACTOR);

		expect(result.isError).toBe(true);
		expect(vi.mocked(setChecklist)).not.toHaveBeenCalled();
	});
});
