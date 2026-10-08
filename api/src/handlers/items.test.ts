/**
 * Item handler tests — the window contract the planning views rely on (the body
 * stays an array, the match count rides in X-Total-Count, `limit` passes through
 * to the service, which clamps it), the move route's rejection contract, and whose
 * actor a status write carries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ResolvedProject } from '@specboard/db';

vi.mock('@specboard/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/db')>();
	return {
		itemView: actual.itemView,
		isValidTitle: actual.isValidTitle,
		isValidType: actual.isValidType,
		isValidStatus: actual.isValidStatus,
		MAX_TITLE_LENGTH: actual.MAX_TITLE_LENGTH,
		isValidSubStatus: actual.isValidSubStatus,
		isValidBranchName: actual.isValidBranchName,
		MAX_BRANCH_NAME_LENGTH: actual.MAX_BRANCH_NAME_LENGTH,
		itemViews: actual.itemViews,
		getItems: vi.fn(),
		createItem: vi.fn(),
		createItems: vi.fn(),
		updateItem: vi.fn(),
		moveItem: vi.fn(),
		wouldCreateCycle: vi.fn(),
		deleteItem: vi.fn(),
		startItem: vi.fn(),
		completeItem: vi.fn(),
		blockItem: vi.fn(),
		unblockItem: vi.fn(),
		getItemKeysBySpecPath: vi.fn(),
		verifyItemOwnership: vi.fn(async () => true),
		ParentItemNotFoundError: class extends Error {},
		DiscoveredFromNotFoundError: class extends Error {},
		ItemCycleError: class extends Error {},
	};
});

import { getItems, moveItem, updateItem, startItem, completeItem, blockItem, unblockItem, wouldCreateCycle, verifyItemOwnership, ItemCycleError } from '@specboard/db';
import { handleListItems, handleMoveItem, handleUpdateItem, handleStartItem, handleCompleteItem, handleBlockItem, handleUnblockItem } from './items.ts';

const PROJECT: ResolvedProject = { id: 'proj-1', slug: 'specboard', ownerSlug: 'acme', key: 'SB' };

function createApp(): Hono<{ Variables: { userId: string; project: ResolvedProject } }> {
	const app = new Hono<{ Variables: { userId: string; project: ResolvedProject } }>();
	app.use('*', async (context, next) => {
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.get('/api/projects/:owner/:project/items', handleListItems);
	app.post('/api/projects/:owner/:project/items/:itemKey/move', handleMoveItem);
	app.put('/api/projects/:owner/:project/items/:itemKey', handleUpdateItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/start', handleStartItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/complete', handleCompleteItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/block', handleBlockItem);
	app.post('/api/projects/:owner/:project/items/:itemKey/unblock', handleUnblockItem);
	return app;
}

function move(itemKey: string, body: unknown): Promise<Response> {
	return Promise.resolve(createApp().request(`http://localhost/api/projects/acme/specboard/items/${itemKey}/move`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	}));
}

function list(query: string): Promise<Response> {
	return Promise.resolve(createApp().request(`http://localhost/api/projects/acme/specboard/items${query}`));
}

const ITEM = { id: 'i-1', key: 'SB-1', title: 'One', origin: null };

beforeEach(() => {
	vi.mocked(getItems).mockReset();
	vi.mocked(moveItem).mockReset();
	vi.mocked(wouldCreateCycle).mockReset();
	vi.mocked(wouldCreateCycle).mockResolvedValue(false);
	vi.mocked(verifyItemOwnership).mockReset();
	vi.mocked(verifyItemOwnership).mockResolvedValue(true);
});

describe('handleListItems', () => {
	it('returns the page as a plain array and the match count in X-Total-Count', async () => {
		vi.mocked(getItems).mockResolvedValue({ items: [ITEM as never], total: 842 });

		const response = await list('?status=done&limit=100');

		expect(response.status).toBe(200);
		expect(response.headers.get('X-Total-Count')).toBe('842');
		expect(await response.json()).toEqual([expect.objectContaining({ key: 'SB-1' })]);
		expect(getItems).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', status: 'done', limit: 100 }));
	});

	it('hands search through with status, and counts the deep match set in X-Total-Count', async () => {
		const child = { id: 'i-2', key: 'SB-42', parentKey: 'SB-7', title: 'Login form', origin: null };
		vi.mocked(getItems).mockResolvedValue({ items: [child as never], total: 31 });

		const response = await list('?search=SB-12&status=ready');

		expect(response.headers.get('X-Total-Count')).toBe('31');
		expect(await response.json()).toEqual([expect.objectContaining({ key: 'SB-42', parentKey: 'SB-7' })]);
		expect(getItems).toHaveBeenCalledWith(expect.objectContaining({ search: 'SB-12', status: 'ready' }));
	});

	it('sends no search at all for an empty one', async () => {
		vi.mocked(getItems).mockResolvedValue({ items: [], total: 0 });

		await list('?search=');

		expect(getItems).toHaveBeenCalledWith(expect.objectContaining({ search: undefined }));
	});

	it('defaults limit to 500 and hands any explicit value to the service unclamped', async () => {
		vi.mocked(getItems).mockResolvedValue({ items: [], total: 0 });

		await list('');
		await list('?limit=99999');
		await list('?limit=abc');

		const limits = vi.mocked(getItems).mock.calls.map(([params]) => params.limit);
		expect(limits).toEqual([500, 99999, 500]);
	});
});

describe('handleMoveItem', () => {
	it('reparents by key and returns the moved item', async () => {
		vi.mocked(moveItem).mockResolvedValue({ key: 'SB-42', parentKey: 'SB-7', parentTitle: 'Auth System', origin: null } as never);

		const response = await move('SB-42', { parentKey: 'SB-7' });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ key: 'SB-42', parentKey: 'SB-7', parentTitle: 'Auth System' });
		expect(moveItem).toHaveBeenCalledWith('proj-1', 42, 7);
	});

	it('promotes to top-level on a null parentKey', async () => {
		vi.mocked(moveItem).mockResolvedValue({ key: 'SB-42', parentKey: null, parentTitle: null, origin: null } as never);

		const response = await move('SB-42', { parentKey: null });

		expect(response.status).toBe(200);
		expect(moveItem).toHaveBeenCalledWith('proj-1', 42, null);
	});

	it('rejects a cycle-forming move without writing, so the item keeps the parent it had', async () => {
		vi.mocked(wouldCreateCycle).mockResolvedValue(true);

		const response = await move('SB-7', { parentKey: 'SB-42' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Cannot move an item under itself or one of its descendants' });
		// The invariant the guard exists for: nothing was detached on the way to the refusal.
		expect(moveItem).not.toHaveBeenCalled();
	});

	it('reports a cycle the service caught inside its UPDATE as a 400, not a 500', async () => {
		// The pre-check and the UPDATE's own guard are separate: a concurrent move can
		// close the cycle between them, and the service is the one that must win.
		vi.mocked(moveItem).mockRejectedValue(new ItemCycleError());

		const response = await move('SB-7', { parentKey: 'SB-42' });

		expect(response.status).toBe(400);
	});

	it('refuses to make an item its own parent', async () => {
		const response = await move('SB-42', { parentKey: 'SB-42' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'An item cannot be its own parent' });
		expect(moveItem).not.toHaveBeenCalled();
	});

	it('404s a parent key that names nothing in this project', async () => {
		vi.mocked(verifyItemOwnership).mockImplementation(async (_projectId: string, number: number) => number !== 99);

		const response = await move('SB-42', { parentKey: 'SB-99' });

		expect(response.status).toBe(404);
		expect(moveItem).not.toHaveBeenCalled();
	});

	it('400s a parentKey that is not a key at all', async () => {
		const response = await move('SB-42', { parentKey: 'not-a-key' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid parentKey' });
	});
});

describe('status writes', () => {
	const USER_ACTOR = { type: 'user', userId: 'user-1' };
	const STAMPED = { ...ITEM, status: 'done', startedAt: new Date('2026-10-01T10:00:00Z'), completedAt: new Date('2026-10-02T10:00:00Z') };

	function send(method: string, path: string, body?: unknown): Promise<Response> {
		return Promise.resolve(createApp().request(`http://localhost/api/projects/acme/specboard/items/SB-1${path}`, {
			method,
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}));
	}

	it('a PUT records the signed-in user as the actor and never passes the stamps through', async () => {
		vi.mocked(updateItem).mockResolvedValue(STAMPED as never);

		const response = await send('PUT', '', {
			title: 'One', status: 'done', subStatus: 'complete', startedAt: '2001-01-01T00:00:00Z', completedAt: '2001-01-01T00:00:00Z',
		});

		expect(response.status).toBe(200);
		const [, , fields, actor] = vi.mocked(updateItem).mock.calls[0]!;
		expect(fields).not.toHaveProperty('startedAt');
		expect(fields).not.toHaveProperty('completedAt');
		expect(actor).toEqual(USER_ACTOR);
		expect(await response.json()).toMatchObject({ startedAt: '2026-10-01T10:00:00.000Z', completedAt: '2026-10-02T10:00:00.000Z' });
	});

	it('the lifecycle routes record the signed-in user as the actor', async () => {
		for (const fn of [startItem, completeItem, blockItem, unblockItem]) vi.mocked(fn).mockResolvedValue(STAMPED as never);

		for (const route of ['start', 'complete', 'block', 'unblock']) {
			expect((await send('POST', `/${route}`)).status).toBe(200);
		}

		for (const fn of [startItem, completeItem, blockItem, unblockItem]) {
			expect(fn).toHaveBeenCalledWith('proj-1', 1, USER_ACTOR);
		}
	});
});
