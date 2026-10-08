/**
 * People over REST, through the real app against a migrated database (PGlite): item,
 * activity-log and worker actors read back named and without user ids, an item's
 * assignee is set and cleared by slug on the item PUT and refused for anyone not on the
 * project or anyone below editor, and removing a member or leaving unassigns their open
 * items. The session cookie's value is the user id; rate limiting and CSRF pass through.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Context, Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

vi.mock('@specboard/auth', async (importOriginal) => {
	const passThrough = () => async (_context: Context, next: () => Promise<void>): Promise<void> => next();
	return {
		...(await importOriginal<typeof import('@specboard/auth')>()),
		getSession: vi.fn(async (_redis: unknown, id: string) => ({ userId: id, csrfToken: 'csrf', createdAt: 0 })),
		rateLimitMiddleware: passThrough,
		csrfMiddleware: passThrough,
	};
});

vi.mock('@specboard/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/core')>()),
	logRequest: vi.fn(),
	reportError: vi.fn(async () => {}),
}));

import { SESSION_COOKIE_NAME } from '@specboard/auth';
import { migratedDb } from '@specboard/db/test-support';
import { createApp } from './app.ts';

const users = {} as Record<'owner' | 'editor' | 'viewer' | 'outsider' | 'leaver', string>;
let db: PGlite;
let app: Hono;

const ALICE = { slug: 'acme', name: 'Alice Ames', avatarUrl: null };
const ERIN = { slug: 'erin', name: 'erin', avatarUrl: null };
const ITEMS = 'http://localhost/api/projects/acme/roadmap/items';

async function insertUser(slug: string, name?: [string, string]): Promise<string> {
	return (await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email, first_name, last_name) VALUES ($1, $1, $2, $3, $4) RETURNING id',
		[slug, `${slug}@example.com`, name?.[0] ?? null, name?.[1] ?? null]
	)).rows[0]!.id;
}

async function call(as: keyof typeof users, method: string, url: string, body?: unknown): Promise<Response> {
	return app.request(url, {
		method,
		headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${users[as]}` },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function createTask(title: string, as: keyof typeof users = 'owner'): Promise<string> {
	const response = await call(as, 'POST', ITEMS, { title, type: 'task' });
	expect(response.status).toBe(201);
	return ((await response.json()) as { key: string }).key;
}

/** The response body as text, checked for every seeded user id before it is parsed. */
async function idFree(response: Response): Promise<unknown> {
	const body = await response.text();
	for (const id of Object.values(users)) expect(body).not.toContain(id);
	return JSON.parse(body);
}

async function assign(as: keyof typeof users, key: string, assigneeSlug: unknown): Promise<Response> {
	return call(as, 'PUT', `${ITEMS}/${key}`, { assigneeSlug });
}

async function assigneeOf(key: string): Promise<unknown> {
	return ((await idFree(await call('viewer', 'GET', `${ITEMS}/${key}`))) as { assignee: unknown }).assignee;
}

beforeAll(async () => {
	db = await migratedDb();
	state.db = db;
	// The pool reads its URL before it is built; pg is PGlite underneath, so any value does.
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	users.owner = await insertUser('acme', ['Alice', 'Ames']);
	users.editor = await insertUser('erin');
	users.viewer = await insertUser('vera');
	users.outsider = await insertUser('sam');
	users.leaver = await insertUser('lee');
	const project = (await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id", [users.owner]
	)).rows[0]!.id;
	for (const [who, role] of [['editor', 'editor'], ['viewer', 'viewer'], ['leaver', 'editor']] as const) {
		await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [project, users[who], role]);
	}
	for (const who of ['owner', 'editor', 'leaver'] as const) {
		await db.query(
			"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, $2, $2, 'token', '{repo}')",
			[users[who], `${who}-gh`]
		);
	}

	app = createApp({} as Redis) as unknown as Hono;
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

describe('actors', () => {
	it('name who created an item and who wrote each log entry, with no user id', async () => {
		const key = await createTask('Named', 'editor');
		expect((await call('owner', 'POST', `${ITEMS}/${key}/notes`, { note: 'Looked at it' })).status).toBe(201);

		const item = await idFree(await call('viewer', 'GET', `${ITEMS}/${key}`));
		const notes = await idFree(await call('viewer', 'GET', `${ITEMS}/${key}/notes`));
		const listed = await idFree(await call('viewer', 'GET', ITEMS));

		expect(item).toMatchObject({ origin: { actor: { type: 'user', person: ERIN } }, assignee: null });
		expect(notes).toEqual([expect.objectContaining({ note: 'Looked at it', actor: { type: 'user', person: ALICE } })]);
		expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ key, origin: { actor: { type: 'user', person: ERIN } } })]));
	});

	it('read a deleted account as a person of null', async () => {
		const goneId = await insertUser('gone');
		const key = await createTask('Orphaned');
		await db.query(
			"INSERT INTO item_notes (item_id, note, actor) SELECT id, 'old entry', $1::jsonb FROM items WHERE title = 'Orphaned'",
			[JSON.stringify({ type: 'user', userId: goneId })]
		);
		await db.query('DELETE FROM users WHERE id = $1', [goneId]);

		const response = await call('viewer', 'GET', `${ITEMS}/${key}/notes`);
		const body = await response.text();

		expect(body).not.toContain(goneId);
		expect(JSON.parse(body)).toEqual([expect.objectContaining({ note: 'old entry', actor: { type: 'user', person: null } })]);
	});
});

describe('assignee', () => {
	it('is set by slug, to a member or the owner, and cleared with null', async () => {
		const key = await createTask('Assign me');

		const assigned = await assign('editor', key, 'erin');
		expect(assigned.status).toBe(200);
		expect(await idFree(assigned)).toMatchObject({ key, assignee: ERIN });
		expect(await assigneeOf(key)).toEqual(ERIN);

		expect(await idFree(await assign('editor', key, 'acme'))).toMatchObject({ assignee: ALICE });

		expect(await idFree(await assign('editor', key, null))).toMatchObject({ assignee: null });
		expect(await assigneeOf(key)).toBeNull();
	});

	it('survives a save that restates the whole item, assignee view and all', async () => {
		const key = await createTask('Restated');
		await assign('editor', key, 'erin');
		const item = (await (await call('editor', 'GET', `${ITEMS}/${key}`)).json()) as Record<string, unknown>;

		const saved = await call('editor', 'PUT', `${ITEMS}/${key}`, { ...item, title: 'Restated twice' });

		expect(await saved.json()).toMatchObject({ title: 'Restated twice', assignee: ERIN });
	});

	it('refuses someone who isn\'t on the project, or anything that isn\'t a slug', async () => {
		const key = await createTask('Refused');
		for (const slug of ['sam', 'nobody']) {
			const response = await assign('editor', key, slug);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: `${slug} is not the owner or a member of this project` });
		}
		for (const bad of ['', 42, { slug: 'erin' }]) {
			expect((await assign('editor', key, bad)).status).toBe(400);
		}
		expect(await assigneeOf(key)).toBeNull();
	});

	it('refuses a viewer', async () => {
		const key = await createTask('Not yours');

		const response = await assign('viewer', key, 'vera');

		expect(response.status).toBe(403);
		expect(await assigneeOf(key)).toBeNull();
	});
});

describe('a departing member', () => {
	it('is unassigned from their open items when the owner removes them, and keeps done ones', async () => {
		const open = await createTask('Open for erin');
		const done = await createTask('Done by erin');
		await assign('editor', open, 'erin');
		await assign('editor', done, 'erin');
		await call('editor', 'PUT', `${ITEMS}/${done}`, { status: 'done' });

		expect((await call('owner', 'DELETE', 'http://localhost/api/projects/acme/roadmap/members/erin')).status).toBe(200);

		expect(await assigneeOf(open)).toBeNull();
		expect(await assigneeOf(done)).toEqual(ERIN);
	});

	it('is unassigned from their open items when they leave', async () => {
		const open = await createTask('Open for lee');
		await assign('owner', open, 'lee');

		expect((await call('leaver', 'DELETE', 'http://localhost/api/projects/acme/roadmap/membership')).status).toBe(200);

		expect(await assigneeOf(open)).toBeNull();
	});
});

describe('item update validation', () => {
	it('refuses a bad sub-status or an over-long branch with a 400, and takes null for either', async () => {
		const key = await createTask('Validated');

		expect((await call('owner', 'PUT', `${ITEMS}/${key}`, { subStatus: 'nah' })).status).toBe(400);
		expect((await call('owner', 'PUT', `${ITEMS}/${key}`, { branchName: 'b'.repeat(256) })).status).toBe(400);
		expect((await call('owner', 'PUT', `${ITEMS}/${key}`, { subStatus: null, branchName: null })).status).toBe(200);
	});
});
