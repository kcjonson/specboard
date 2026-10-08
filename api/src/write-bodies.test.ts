/**
 * Write bodies that aren't JSON objects. The production app runs with its real
 * handlers over a migrated database (PGlite), and every write that reads an object
 * body is sent an array, null, a string, a number, and JSON that doesn't parse. Each
 * one is a 400 in the API's { error } shape, and no table changes.
 *
 * Rate limiting and CSRF are passed through; the session cookie's value is the user id.
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
import { addChecklistEntry, createItem } from '@specboard/db';
import { migratedDb } from '@specboard/db/test-support';
import { createApp } from './app.ts';

const PROJECT = '/api/projects/acme/roadmap';

/** Every table a write below could touch. */
const TABLES = [
	'projects',
	'items',
	'item_notes',
	'item_blockers',
	'item_transitions',
	'epic_specs',
	'project_members',
	'project_invitations',
	'map_baselines',
];

const BAD_BODIES: Array<[string, string, string]> = [
	['an array', '[1,2]', 'Request body must be a JSON object'],
	['null', 'null', 'Request body must be a JSON object'],
	['a string', '"x"', 'Request body must be a JSON object'],
	['a number', '5', 'Request body must be a JSON object'],
	['malformed JSON', '{"title":', 'Invalid JSON'],
];

let app: Hono;
let owner: string;
let checklistEntryId: string;

function routes(): Array<[string, string]> {
	return [
		['POST', '/api/projects'],
		['PUT', PROJECT],
		['POST', `${PROJECT}/items`],
		['POST', `${PROJECT}/items/RM-1/children`],
		['PUT', `${PROJECT}/items/RM-1`],
		['POST', `${PROJECT}/items/RM-1/move`],
		['POST', `${PROJECT}/items/RM-1/specs`],
		['POST', `${PROJECT}/items/RM-1/blockers`],
		['POST', `${PROJECT}/items/RM-1/checklist`],
		['PUT', `${PROJECT}/items/RM-1/checklist/${checklistEntryId}`],
		['POST', `${PROJECT}/items/RM-1/notes`],
		['POST', `${PROJECT}/map/seen`],
		['PUT', `${PROJECT}/members/vera`],
		['POST', `${PROJECT}/invitations`],
		['POST', `${PROJECT}/folders`],
		['PUT', `${PROJECT}/files?path=docs/a.md`],
		['PUT', `${PROJECT}/files/rename`],
		['POST', `${PROJECT}/git/restore`],
		['POST', `${PROJECT}/chat`],
	];
}

async function send(method: string, path: string, body: string): Promise<Response> {
	return app.request(`http://localhost${path}`, {
		method,
		headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${owner}` },
		body,
	});
}

/** One hash per table over every row, so any insert, update, or delete shows. */
async function snapshot(): Promise<Record<string, string>> {
	const hashes: Record<string, string> = {};
	for (const table of TABLES) {
		const result = await state.db!.query<{ hash: string }>(
			`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash FROM ${table} t`
		);
		hashes[table] = result.rows[0]!.hash;
	}
	return hashes;
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');
	vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');

	const users = await db.query<{ id: string }>(
		"INSERT INTO users (username, slug, email) VALUES ('acme', 'acme', 'acme@example.com'), ('vera', 'vera', 'vera@example.com') RETURNING id"
	);
	owner = users.rows[0]!.id;
	const vera = users.rows[1]!.id;
	await db.query(
		"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, 'acme-gh', 'acme-gh', 'token', '{repo}')",
		[owner]
	);
	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[owner]
	);
	const projectId = project.rows[0]!.id;
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [projectId, vera]);
	await createItem(projectId, { title: 'One', origin: { actor: { type: 'user', userId: owner } } });
	const entry = await addChecklistEntry(projectId, 1, 'First');
	checklistEntryId = entry!.id;

	app = createApp({} as Redis) as unknown as Hono;
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

describe('a write body that is not a JSON object', () => {
	it('is a 400 on every write that reads one, and writes nothing', async () => {
		const before = await snapshot();
		const mismatches: string[] = [];
		for (const [method, path] of routes()) {
			for (const [what, body, error] of BAD_BODIES) {
				const response = await send(method, path, body);
				const answer = await response.json() as { error?: unknown };
				if (response.status !== 400 || answer.error !== error) {
					mismatches.push(`${method} ${path} with ${what}: ${response.status} ${JSON.stringify(answer)}`);
				}
			}
		}
		expect(mismatches).toEqual([]);
		expect(await snapshot()).toEqual(before);
	});
});

describe('creating an item', () => {
	it.each([
		['no title', {}],
		['an empty title', { title: '' }],
		['a title that is not a string', { title: 5 }],
	])('refuses %s instead of naming it Untitled', async (_what, body) => {
		const before = await snapshot();
		const response = await send('POST', `${PROJECT}/items`, JSON.stringify(body));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Title must be between 1 and 255 characters' });
		expect(await snapshot()).toEqual(before);
	});

	it('still creates one from an object with a title', async () => {
		const response = await send('POST', `${PROJECT}/items`, JSON.stringify({ title: 'Ship it', type: 'task' }));

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({ key: 'RM-2', title: 'Ship it', type: 'task' });
	});

	it('refuses a child that is not an object', async () => {
		const response = await send('POST', `${PROJECT}/items/RM-1/children`, JSON.stringify({ items: [null] }));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Each item needs a valid title' });
	});
});
