/**
 * The role matrix at the authorization boundary (docs/specs/multi-user-collaboration.md,
 * Authorization).
 *
 * The production app is built and its route table read back: every registered route
 * under /api/projects/:owner/:project must carry a requireProjectAccess gate with a
 * declared minimum role, and each one is then called as the owner, an editor, an
 * editor without GitHub, a viewer, a non-member, and a logged-out visitor. Memberships
 * and GitHub connections are seeded in a real migrated database (PGlite), so the gate
 * runs the real resolver. Handlers are replaced with a stand-in that only reports it
 * was reached: this suite tests who gets through, not what the handlers do.
 *
 * Rate limiting and CSRF are passed through. In production a logged-out write is
 * refused by CSRF (403) before the gate; here the gate's own answer, 401, is asserted.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Context, Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { PGlite } from '@electric-sql/pglite';
import type { ProjectRole } from '@specboard/db';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

const { stubHandlers } = vi.hoisted(() => ({
	/** Replace every exported handle* with a stand-in that answers 200 and its own name. */
	stubHandlers: (module: Record<string, unknown>): Record<string, unknown> =>
		Object.fromEntries(
			Object.entries(module).map(([name, value]) => [
				name,
				typeof value === 'function' && name.startsWith('handle')
					? (context: Context) => context.json({ reached: name }, 200)
					: value,
			])
		),
}));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

vi.mock('@specboard/auth', async (importOriginal) => {
	const passThrough = () => async (_context: Context, next: () => Promise<void>): Promise<void> => next();
	return {
		...(await importOriginal<typeof import('@specboard/auth')>()),
		// The session cookie's value is the user id; no cookie is no session.
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

vi.mock('./handlers/projects.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/members.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/storage/file-handlers.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/storage/git-handlers.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/storage/folder-handlers.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/github-sync.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/chat.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/items.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/map.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/specs.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/blockers.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/checklist.ts', async (importOriginal) => stubHandlers(await importOriginal()));
vi.mock('./handlers/notes.ts', async (importOriginal) => stubHandlers(await importOriginal()));

import { SESSION_COOKIE_NAME } from '@specboard/auth';
import { migratedDb } from '@specboard/db/test-support';
import { createApp } from './app.ts';
import { declaredMinRole } from './project-access.ts';

const PROJECT_PREFIX = '/api/projects/:owner/:project';

type Persona = 'owner' | 'editor' | 'editorWithoutGitHub' | 'viewer' | 'nonMember' | 'loggedOut';

type Outcome = 'allowed' | 'viewer' | 'github_not_connected' | 'owner_only' | 'not_found' | 'unauthorized';

/**
 * What each persona gets from a route needing each role. Written out rather than
 * derived from the code under test, so a loosened check can't agree with itself.
 */
const EXPECTED: Record<Persona, Record<ProjectRole, Outcome>> = {
	owner: { viewer: 'allowed', editor: 'allowed', owner: 'allowed' },
	editor: { viewer: 'allowed', editor: 'allowed', owner: 'owner_only' },
	editorWithoutGitHub: { viewer: 'allowed', editor: 'github_not_connected', owner: 'owner_only' },
	viewer: { viewer: 'allowed', editor: 'viewer', owner: 'owner_only' },
	nonMember: { viewer: 'not_found', editor: 'not_found', owner: 'not_found' },
	loggedOut: { viewer: 'unauthorized', editor: 'unauthorized', owner: 'unauthorized' },
};

const PERSONAS = Object.keys(EXPECTED) as Persona[];

/** The routes the spec makes owner-only: settings, repository, folders, delete, members. */
const OWNER_ONLY = new Set([
	`PUT ${PROJECT_PREFIX}`,
	`DELETE ${PROJECT_PREFIX}`,
	`POST ${PROJECT_PREFIX}/folders`,
	`DELETE ${PROJECT_PREFIX}/folders`,
	`PUT ${PROJECT_PREFIX}/members/:member`,
	`DELETE ${PROJECT_PREFIX}/members/:member`,
]);

/**
 * Non-GET routes a viewer may call, each for a reason: reads that take a body, state
 * that is the caller's own, AI chat (viewer in the spec), and leaving the project.
 */
const VIEWER_WRITES = new Set([
	`POST ${PROJECT_PREFIX}/tree`,
	`POST ${PROJECT_PREFIX}/map/seen`,
	`POST ${PROJECT_PREFIX}/chat`,
	`DELETE ${PROJECT_PREFIX}/membership`,
]);

interface ProjectRoute {
	method: string;
	path: string;
	label: string;
	minRole: ProjectRole | undefined;
}

/** The project-scoped routes as registered, one per method and path, with the role their gate declares. */
function projectRoutes(app: Hono): ProjectRoute[] {
	const byRoute = new Map<string, ProjectRoute>();
	for (const route of app.routes) {
		if (!route.path.startsWith(PROJECT_PREFIX)) continue;
		const label = `${route.method} ${route.path}`;
		const entry = byRoute.get(label) ?? { method: route.method, path: route.path, label, minRole: undefined };
		entry.minRole ??= declaredMinRole(route.handler);
		byRoute.set(label, entry);
	}
	return [...byRoute.values()];
}

const PARAMS: Record<string, string> = { owner: 'acme', project: 'roadmap', itemKey: 'RM-1', member: 'vera', id: '1' };

function concretePath(path: string): string {
	return path.replace(/:(\w+)(\{[^}]*\})?/g, (_match, name: string) => PARAMS[name] ?? 'x');
}

const users = {} as Record<Exclude<Persona, 'loggedOut'>, string>;

async function insertUser(db: PGlite, slug: string): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email) VALUES ($1, $1, $2) RETURNING id',
		[slug, `${slug}@example.com`]
	);
	return result.rows[0]!.id;
}

async function connectGitHub(db: PGlite, userId: string, login: string): Promise<void> {
	await db.query(
		"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, $2, $2, 'token', '{repo}')",
		[userId, login]
	);
}

let app: Hono;

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	// The pool reads its URL before it is built; pg is PGlite underneath, so any value does.
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	users.owner = await insertUser(db, 'acme');
	users.editor = await insertUser(db, 'erin');
	users.editorWithoutGitHub = await insertUser(db, 'nick');
	users.viewer = await insertUser(db, 'vera');
	users.nonMember = await insertUser(db, 'sam');

	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[users.owner]
	);
	const projectId = project.rows[0]!.id;
	// The non-member owns a project of their own, so "no access" isn't "no projects".
	await db.query("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM')", [users.nonMember]);

	await connectGitHub(db, users.owner, 'acme-gh');
	await connectGitHub(db, users.editor, 'erin-gh');
	await connectGitHub(db, users.viewer, 'vera-gh');
	await connectGitHub(db, users.nonMember, 'sam-gh');
	for (const [persona, role] of [['editor', 'editor'], ['editorWithoutGitHub', 'editor'], ['viewer', 'viewer']] as const) {
		await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, users[persona], role]);
	}

	vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');
	app = createApp({} as Redis) as unknown as Hono;
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

async function call(route: ProjectRoute, persona: Persona): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (persona !== 'loggedOut') headers.cookie = `${SESSION_COOKIE_NAME}=${users[persona]}`;
	return app.request(`http://localhost${concretePath(route.path)}`, {
		method: route.method,
		headers,
		...(route.method === 'GET' ? {} : { body: '{}' }),
	});
}

describe('the project route table', () => {
	it('has project-scoped routes to check', () => {
		expect(projectRoutes(app).length).toBeGreaterThan(40);
	});

	it('puts every project route under /api/projects/:owner/:project', () => {
		const stray = app.routes
			.filter((route) => route.path.startsWith('/api/projects/') && !route.path.startsWith(PROJECT_PREFIX))
			.map((route) => `${route.method} ${route.path}`);
		expect(stray).toEqual([]);
	});

	it('declares a minimum role on every project route', () => {
		const undeclared = projectRoutes(app).filter((route) => !route.minRole).map((route) => route.label);
		expect(undeclared).toEqual([]);
	});

	it('keeps reads at viewer', () => {
		const raised = projectRoutes(app).filter((route) => route.method === 'GET' && route.minRole !== 'viewer');
		expect(raised.map((route) => `${route.label}: ${route.minRole}`)).toEqual([]);
	});

	it('needs at least editor for every write but the listed viewer ones', () => {
		const loose = projectRoutes(app).filter(
			(route) => route.method !== 'GET' && route.minRole === 'viewer' && !VIEWER_WRITES.has(route.label)
		);
		expect(loose.map((route) => route.label)).toEqual([]);
	});

	it('makes exactly the spec\'s owner-only routes owner-only', () => {
		const owned = projectRoutes(app).filter((route) => route.minRole === 'owner').map((route) => route.label);
		expect(new Set(owned)).toEqual(OWNER_ONLY);
	});

	it('mounts adding a local folder only when LOCAL_STORAGE_ENABLED is true', () => {
		const addsFolder = (built: Hono): boolean =>
			built.routes.some((route) => route.method === 'POST' && route.path === `${PROJECT_PREFIX}/folders`);
		expect(addsFolder(app)).toBe(true);
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '1');
		expect(addsFolder(createApp({} as Redis) as unknown as Hono)).toBe(false);
		vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');
	});
});

describe('the role matrix', () => {
	it('answers every route for every persona as the matrix says', async () => {
		const mismatches: string[] = [];
		const cases = projectRoutes(app).flatMap((route) => PERSONAS.map((persona) => [route.label, persona, route] as const));
		for (const [label, persona, route] of cases) {
			const expected = route.minRole ? EXPECTED[persona][route.minRole] : 'gated';
			const response = await call(route, persona);
			const body = await response.json() as { reached?: string; reason?: string };

			const actual: string =
				response.status === 200 && body.reached ? 'allowed'
				: response.status === 403 && body.reason ? body.reason
				: response.status === 404 && !body.reached ? 'not_found'
				: response.status === 401 ? 'unauthorized'
				: `status ${response.status}`;

			if (actual !== expected) mismatches.push(`${label} as ${persona}: expected ${expected}, got ${actual}`);
		}
		expect(mismatches).toEqual([]);
	});

	it('refuses a malformed address before resolving it', async () => {
		const response = await app.request('http://localhost/api/projects/acme_co/roadmap/items', {
			headers: { cookie: `${SESSION_COOKIE_NAME}=${users.owner}` },
		});
		expect(response.status).toBe(400);
	});

	it('answers a project that doesn\'t exist as it answers one the caller can\'t reach', async () => {
		const missing = await app.request('http://localhost/api/projects/acme/nope/items', {
			headers: { cookie: `${SESSION_COOKIE_NAME}=${users.owner}` },
		});
		const hidden = await app.request('http://localhost/api/projects/acme/roadmap/items', {
			headers: { cookie: `${SESSION_COOKIE_NAME}=${users.nonMember}` },
		});
		expect(missing.status).toBe(404);
		expect(hidden.status).toBe(404);
		expect(await missing.json()).toEqual(await hidden.json());
	});
});
