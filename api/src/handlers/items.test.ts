/**
 * Item list handler tests — the window contract the planning views rely on:
 * the body stays an array, the match count rides in X-Total-Count, and `limit`
 * passes through to the service (which clamps it).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ResolvedProject } from '@specboard/db';

vi.mock('@specboard/db', () => ({
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
}));

import { getItems } from '@specboard/db';
import { handleListItems } from './items.ts';

const PROJECT: ResolvedProject = { id: 'proj-1', slug: 'specboard', key: 'SB' };

function createApp(): Hono<{ Variables: { userId: string; project: ResolvedProject } }> {
	const app = new Hono<{ Variables: { userId: string; project: ResolvedProject } }>();
	app.use('*', async (context, next) => {
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.get('/api/projects/:projectSlug/items', handleListItems);
	return app;
}

function list(query: string): Promise<Response> {
	return Promise.resolve(createApp().request(`http://localhost/api/projects/specboard/items${query}`));
}

const ITEM = { id: 'i-1', key: 'SB-1', title: 'One', origin: null };

beforeEach(() => {
	vi.mocked(getItems).mockReset();
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

	it('defaults limit to 500 and hands any explicit value to the service unclamped', async () => {
		vi.mocked(getItems).mockResolvedValue({ items: [], total: 0 });

		await list('');
		await list('?limit=99999');
		await list('?limit=abc');

		const limits = vi.mocked(getItems).mock.calls.map(([params]) => params.limit);
		expect(limits).toEqual([500, 99999, 500]);
	});
});
