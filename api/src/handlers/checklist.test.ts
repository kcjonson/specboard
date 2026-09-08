/**
 * Checklist handler tests.
 *
 * The load-bearing assertion: a PUT carrying only `status` reaches the service with
 * no `text` key, so a toggle can't blank the entry's text.
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
	getChecklist: vi.fn(),
	addChecklistEntry: vi.fn(),
	updateChecklistEntry: vi.fn(),
	removeChecklistEntry: vi.fn(),
	ChecklistValidationError: class extends Error {},
	ParentItemNotFoundError: class extends Error {},
	DiscoveredFromNotFoundError: class extends Error {},
	ItemCycleError: class extends Error {},
}));

import {
	getChecklist,
	addChecklistEntry,
	updateChecklistEntry,
	removeChecklistEntry,
	ChecklistValidationError,
} from '@specboard/db';
import {
	handleListChecklist,
	handleAddChecklistEntry,
	handleUpdateChecklistEntry,
	handleDeleteChecklistEntry,
} from './checklist.ts';

const PROJECT: ResolvedProject = { id: 'proj-1', slug: 'specboard', key: 'SB' };
const ENTRY_ID = '11111111-2222-3333-4444-555555555555';
const BASE = 'http://localhost/api/projects/specboard/items/SB-1/checklist';

type TestVariables = { userId: string | undefined; project?: ResolvedProject };

function createApp(): Hono<{ Variables: TestVariables }> {
	const app = new Hono<{ Variables: TestVariables }>();
	app.use('*', async (context, next) => {
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.get('/api/projects/:projectSlug/items/:itemKey/checklist', handleListChecklist);
	app.post('/api/projects/:projectSlug/items/:itemKey/checklist', handleAddChecklistEntry);
	app.put('/api/projects/:projectSlug/items/:itemKey/checklist/:id', handleUpdateChecklistEntry);
	app.delete('/api/projects/:projectSlug/items/:itemKey/checklist/:id', handleDeleteChecklistEntry);
	return app;
}

function send(method: string, url: string, body?: unknown): Promise<Response> {
	return Promise.resolve(
		createApp().request(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('handleListChecklist', () => {
	it('returns the entries as stored', async () => {
		vi.mocked(getChecklist).mockResolvedValue([
			{ id: ENTRY_ID, text: 'wire the route', status: 'todo' },
			{ id: 'e-2', text: 'write the test', status: 'done' },
		]);

		const res = await send('GET', BASE);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ id: ENTRY_ID, text: 'wire the route', status: 'todo' },
			{ id: 'e-2', text: 'write the test', status: 'done' },
		]);
		expect(vi.mocked(getChecklist)).toHaveBeenCalledWith('proj-1', 1);
	});

	it('404s when the item does not exist', async () => {
		vi.mocked(getChecklist).mockResolvedValue(null);

		const res = await send('GET', BASE);
		expect(res.status).toBe(404);
	});
});

describe('handleAddChecklistEntry', () => {
	it('creates the entry and returns it', async () => {
		vi.mocked(addChecklistEntry).mockResolvedValue({ id: ENTRY_ID, text: 'wire the route', status: 'todo' });

		const res = await send('POST', BASE, { text: 'wire the route' });
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: ENTRY_ID, text: 'wire the route', status: 'todo' });
		expect(vi.mocked(addChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, 'wire the route');
	});

	it('400s when text is missing or not a string', async () => {
		expect((await send('POST', BASE, {})).status).toBe(400);
		expect((await send('POST', BASE, { text: 42 })).status).toBe(400);
		expect(vi.mocked(addChecklistEntry)).not.toHaveBeenCalled();
	});

	it('400s on a body that is not JSON', async () => {
		const res = await createApp().request(BASE, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{ not json',
		});
		expect(res.status).toBe(400);
		expect(vi.mocked(addChecklistEntry)).not.toHaveBeenCalled();
	});

	it('maps a too-long-text ChecklistValidationError to a 400', async () => {
		vi.mocked(addChecklistEntry).mockRejectedValue(
			new ChecklistValidationError('Checklist text must be at most 500 characters')
		);

		const res = await send('POST', BASE, { text: 'x'.repeat(501) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Checklist text must be at most 500 characters' });
	});

	it('maps a full-list ChecklistValidationError to a 400', async () => {
		vi.mocked(addChecklistEntry).mockRejectedValue(
			new ChecklistValidationError('A checklist holds at most 100 entries')
		);

		const res = await send('POST', BASE, { text: 'one too many' });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'A checklist holds at most 100 entries' });
	});

	it('404s when the item does not exist', async () => {
		vi.mocked(addChecklistEntry).mockResolvedValue(null);

		const res = await send('POST', BASE, { text: 'wire the route' });
		expect(res.status).toBe(404);
	});
});

describe('handleUpdateChecklistEntry', () => {
	it('patches status without sending a text the caller never supplied', async () => {
		vi.mocked(updateChecklistEntry).mockResolvedValue({ id: ENTRY_ID, text: 'wire the route', status: 'done' });

		const res = await send('PUT', `${BASE}/${ENTRY_ID}`, { status: 'done' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: ENTRY_ID, text: 'wire the route', status: 'done' });

		const changes = vi.mocked(updateChecklistEntry).mock.calls[0]?.[3];
		expect(changes).toEqual({ status: 'done' });
		expect(changes && 'text' in changes).toBe(false);
	});

	it('patches text alone', async () => {
		vi.mocked(updateChecklistEntry).mockResolvedValue({ id: ENTRY_ID, text: 'renamed', status: 'todo' });

		await send('PUT', `${BASE}/${ENTRY_ID}`, { text: 'renamed' });
		expect(vi.mocked(updateChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, ENTRY_ID, { text: 'renamed' });
	});

	it('400s when the body carries neither text nor status', async () => {
		const res = await send('PUT', `${BASE}/${ENTRY_ID}`, { id: ENTRY_ID });
		expect(res.status).toBe(400);
		expect(vi.mocked(updateChecklistEntry)).not.toHaveBeenCalled();
	});

	it('maps a ChecklistValidationError to a 400', async () => {
		vi.mocked(updateChecklistEntry).mockRejectedValue(
			new ChecklistValidationError('Checklist text must be a non-empty string')
		);

		const res = await send('PUT', `${BASE}/${ENTRY_ID}`, { text: '   ' });
		expect(res.status).toBe(400);
	});

	it('404s when the entry does not exist', async () => {
		vi.mocked(updateChecklistEntry).mockResolvedValue(null);

		const res = await send('PUT', `${BASE}/${ENTRY_ID}`, { status: 'done' });
		expect(res.status).toBe(404);
	});
});

describe('handleDeleteChecklistEntry', () => {
	it('removes the entry', async () => {
		vi.mocked(removeChecklistEntry).mockResolvedValue(true);

		const res = await send('DELETE', `${BASE}/${ENTRY_ID}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });
		expect(vi.mocked(removeChecklistEntry)).toHaveBeenCalledWith('proj-1', 1, ENTRY_ID);
	});

	it('404s when the entry does not exist', async () => {
		vi.mocked(removeChecklistEntry).mockResolvedValue(false);

		const res = await send('DELETE', `${BASE}/${ENTRY_ID}`);
		expect(res.status).toBe(404);
	});
});
