/**
 * update_item handler tests — the status shortcuts must not swallow the other
 * fields sent alongside a status change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/db', () => ({
	createItem: vi.fn(),
	createItems: vi.fn(),
	updateItem: vi.fn(async () => ({ key: 'SB-1', title: 'T', status: 'ready', subStatus: null, branchName: null, prUrl: null, blocked: false })),
	moveItem: vi.fn(),
	wouldCreateCycle: vi.fn(async () => false),
	deleteItem: vi.fn(),
	startItem: vi.fn(async () => ({ key: 'SB-1', status: 'in_progress' })),
	completeItem: vi.fn(async () => ({ key: 'SB-1', status: 'done', note: 'shipped' })),
	blockItem: vi.fn(async () => ({ key: 'SB-1', status: 'blocked', note: 'waiting' })),
	unblockItem: vi.fn(async () => ({ key: 'SB-1', status: 'ready' })),
	verifyItemOwnership: vi.fn(async () => true),
	setSpecs: vi.fn(),
	setBlockers: vi.fn(),
	recordWorkerActivity: vi.fn(),
	SpecValidationError: class extends Error {},
	BlockerValidationError: class extends Error {},
	BlockerConflictError: class extends Error {},
	BlockerTargetError: class extends Error {},
	ParentItemNotFoundError: class extends Error {},
	DiscoveredFromNotFoundError: class extends Error {},
	ItemCycleError: class extends Error {},
}));

import { updateItem as updateItemService, startItem, completeItem, blockItem, unblockItem } from '@specboard/db';
import { updateItem } from './writes.ts';

const PROJECT = { id: 'proj-1', slug: 'specboard', key: 'SB' };
const ACTOR = { type: 'agent', userId: 'user-1', sessionId: 's-1' } as never;

const mockUpdate = vi.mocked(updateItemService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('update_item status shortcuts', () => {
	it('applies notes sent with status in_progress', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'in_progress', notes: 'picked this up' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { notes: 'picked this up' });
		expect(vi.mocked(startItem)).toHaveBeenCalled();
	});

	it('applies notes and pr_url sent with status done', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'done', note: 'shipped', notes: 'merged #1', pr_url: 'https://x/1' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { notes: 'merged #1', prUrl: 'https://x/1' });
		expect(vi.mocked(completeItem)).toHaveBeenCalledWith('proj-1', 1, 'shipped');
	});

	it('applies notes sent with status blocked', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'blocked', note: 'waiting', notes: 'needs API key' }, ACTOR);

		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { notes: 'needs API key' });
		expect(vi.mocked(blockItem)).toHaveBeenCalledWith('proj-1', 1, 'waiting');
	});

	it('falls through to the general update when status ready carries other fields', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'ready', notes: 'unblocked by hand' }, ACTOR);

		expect(vi.mocked(unblockItem)).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith('proj-1', 1, { notes: 'unblocked by hand', status: 'ready' });
	});

	it('still takes the bare unblock shortcut for a plain status ready', async () => {
		await updateItem(PROJECT, { item_key: 'SB-1', status: 'ready' }, ACTOR);

		expect(vi.mocked(unblockItem)).toHaveBeenCalledWith('proj-1', 1);
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});
