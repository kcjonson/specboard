/**
 * Item note handler tests.
 *
 * The load-bearing assertion: the actor comes from the authenticated session, so
 * a client can't claim to be someone else by putting an actor in the body.
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
	listItemNotes: vi.fn(async () => []),
	addItemNote: vi.fn(async () => ({ id: 'n-1', note: 'entry', actor: null, createdAt: new Date('2026-01-01T00:00:00Z') })),
	NoteValidationError: class extends Error {},
	ParentItemNotFoundError: class extends Error {},
	DiscoveredFromNotFoundError: class extends Error {},
	ItemCycleError: class extends Error {},
}));

import { listItemNotes, addItemNote, NoteValidationError } from '@specboard/db';
import { handleListItemNotes, handleAddItemNote } from './notes.ts';

const PROJECT: ResolvedProject = { id: 'proj-1', slug: 'specboard', key: 'SB' };

type TestVariables = { userId: string | undefined; project?: ResolvedProject };

function createApp(): Hono<{ Variables: TestVariables }> {
	const app = new Hono<{ Variables: TestVariables }>();
	app.use('*', async (context, next) => {
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.get('/api/projects/:projectSlug/items/:itemKey/notes', handleListItemNotes);
	app.post('/api/projects/:projectSlug/items/:itemKey/notes', handleAddItemNote);
	return app;
}

function post(body: unknown): Promise<Response> {
	return Promise.resolve(
		createApp().request('http://localhost/api/projects/specboard/items/SB-1/notes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(addItemNote).mockResolvedValue({ id: 'n-1', note: 'entry', actor: null, createdAt: new Date('2026-01-01T00:00:00Z') });
});

describe('handleAddItemNote', () => {
	it('captures the actor from the session and ignores one sent in the body', async () => {
		const res = await post({ note: 'entry', actor: { type: 'agent', userId: 'attacker' }, createdBy: 'someone-else' });

		expect(res.status).toBe(201);
		expect(vi.mocked(addItemNote)).toHaveBeenCalledWith('proj-1', 1, 'entry', { type: 'user', userId: 'user-1' });
	});

	it('passes the note through untrimmed — the service owns validation', async () => {
		await post({ note: '  entry  ' });
		expect(vi.mocked(addItemNote)).toHaveBeenCalledWith('proj-1', 1, '  entry  ', { type: 'user', userId: 'user-1' });
	});

	it('400s when note is missing or not a string', async () => {
		const res = await post({});
		expect(res.status).toBe(400);
		expect(vi.mocked(addItemNote)).not.toHaveBeenCalled();
	});

	it('maps a NoteValidationError to a 400', async () => {
		vi.mocked(addItemNote).mockRejectedValue(new NoteValidationError('Note text must be a non-empty string'));

		const res = await post({ note: '   ' });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Note text must be a non-empty string' });
	});

	it('404s when the item is not in this project', async () => {
		vi.mocked(addItemNote).mockResolvedValue(null);

		const res = await post({ note: 'entry' });
		expect(res.status).toBe(404);
	});
});

describe('handleListItemNotes', () => {
	it('strips actor internals from every entry', async () => {
		vi.mocked(listItemNotes).mockResolvedValue([
			{ id: 'n-1', note: 'agent entry', actor: { type: 'agent', userId: 'user-1', clientId: 'oauth-client', sessionId: 'sess-1', deviceName: 'laptop' }, createdAt: new Date('2026-01-02T00:00:00Z') },
			{ id: 'n-2', note: 'backfilled', actor: null, createdAt: new Date('2026-01-01T00:00:00Z') },
		]);

		const res = await createApp().request('http://localhost/api/projects/specboard/items/SB-1/notes');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ id: 'n-1', note: 'agent entry', actor: { type: 'agent', deviceName: 'laptop' }, createdAt: '2026-01-02T00:00:00.000Z' },
			{ id: 'n-2', note: 'backfilled', actor: null, createdAt: '2026-01-01T00:00:00.000Z' },
		]);
	});

	it('404s when the item is not in this project', async () => {
		vi.mocked(listItemNotes).mockResolvedValue(null);

		const res = await createApp().request('http://localhost/api/projects/specboard/items/SB-1/notes');
		expect(res.status).toBe(404);
	});
});
