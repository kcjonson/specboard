/**
 * The MCP half of the role matrix (docs/specs/multi-user-collaboration.md, Authorization).
 *
 * Every tool tools/list advertises must declare a minimum role, and each is then called
 * as the owner, an editor, an editor without GitHub, a viewer, and a non-member, against
 * memberships seeded in a real migrated database (PGlite), so resolution and the role
 * check are the real ones. The item reads and writes behind the check are stand-ins
 * that only report they were reached. A logged-out caller never reaches a tool: the
 * OAuth middleware answers 401 for the whole endpoint.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { AgentActor, ProjectRole } from '@specboard/db';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

const { reached } = vi.hoisted(() => ({
	reached: (name: string) => async () => ({ content: [{ type: 'text', text: `reached ${name}` }] }),
}));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));
vi.mock('@specboard/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/core')>()),
	logRequest: vi.fn(),
}));
vi.mock('./tools/items/reads.ts', () => ({ getItems: reached('getItems') }));
vi.mock('./tools/items/writes.ts', () => ({
	createItem: reached('createItem'),
	createItems: reached('createItems'),
	updateItem: reached('updateItem'),
	deleteItem: reached('deleteItem'),
}));

import { migratedDb } from '@specboard/db/test-support';
import { createApp } from './app.ts';
import { callTool, toolMinRole, tools } from './tools/index.ts';
import type { ToolResult } from './tools/project-ref.ts';

type Persona = 'owner' | 'editor' | 'editorWithoutGitHub' | 'viewer' | 'nonMember';

type Outcome = 'allowed' | 'view access' | 'Connect GitHub' | 'owner' | 'not found';

/** Written out rather than derived from the code under test, so a loosened check can't agree with itself. */
const EXPECTED: Record<Persona, Record<ProjectRole, Outcome>> = {
	owner: { viewer: 'allowed', editor: 'allowed', owner: 'allowed' },
	editor: { viewer: 'allowed', editor: 'allowed', owner: 'owner' },
	editorWithoutGitHub: { viewer: 'allowed', editor: 'Connect GitHub', owner: 'owner' },
	viewer: { viewer: 'allowed', editor: 'view access', owner: 'owner' },
	nonMember: { viewer: 'not found', editor: 'not found', owner: 'not found' },
};

const PERSONAS = Object.keys(EXPECTED) as Persona[];

/** Tools that change the board; the spec makes every one of them editor. */
const WRITE_TOOLS = new Set(['create_item', 'create_items', 'update_item', 'delete_item']);

const users = {} as Record<Persona, string>;

async function insertUser(db: PGlite, slug: string): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email) VALUES ($1, $1, $2) RETURNING id',
		[slug, `${slug}@example.com`]
	);
	return result.rows[0]!.id;
}

function actor(persona: Persona): AgentActor {
	return { type: 'agent', userId: users[persona], clientId: 'client-1', deviceName: 'laptop' };
}

function text(result: ToolResult): string {
	return result.content.map((part) => part.text).join('\n');
}

/** What a call came back as, in the matrix's terms. */
function outcome(name: string, result: ToolResult): string {
	const body = text(result);
	if (name === 'list_projects') {
		if (result.isError) return `error: ${body}`;
		const listed = (JSON.parse(body) as { projects: Array<{ ref: string }> }).projects.map((p) => p.ref);
		return listed.includes('acme/roadmap') ? 'allowed' : 'not found';
	}
	if (!result.isError && body.startsWith('reached ')) return 'allowed';
	if (/doesn't exist, or your account doesn't have access/.test(body)) return 'not found';
	if (/view access/.test(body)) return 'view access';
	if (/Connect GitHub/.test(body)) return 'Connect GitHub';
	if (/Only the project owner/.test(body)) return 'owner';
	return `unexpected: ${body}`;
}

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
	await db.query("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM')", [users.nonMember]);

	for (const persona of ['owner', 'editor', 'viewer', 'nonMember'] as const) {
		await db.query(
			"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, $2, $2, 'token', '{repo}')",
			[users[persona], `${persona}-gh`]
		);
	}
	for (const [persona, role] of [['editor', 'editor'], ['editorWithoutGitHub', 'editor'], ['viewer', 'viewer']] as const) {
		await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, users[persona], role]);
	}
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

describe('the MCP tool registry', () => {
	it('declares a minimum role on every listed tool', () => {
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.filter((tool) => !toolMinRole(tool.name)).map((tool) => tool.name)).toEqual([]);
	});

	it('makes every write tool editor and every other tool viewer', () => {
		const roles = Object.fromEntries(tools.map((tool) => [tool.name, toolMinRole(tool.name)]));
		const expected = Object.fromEntries(tools.map((tool) => [tool.name, WRITE_TOOLS.has(tool.name) ? 'editor' : 'viewer']));
		expect(roles).toEqual(expected);
	});

	it('refuses to call a tool it has no role for', async () => {
		expect(toolMinRole('constructor')).toBeUndefined();
		expect(text(await callTool('constructor', {}, actor('owner'), undefined))).toBe('Unknown tool: constructor');
	});
});

describe('the MCP role matrix', () => {
	it('answers every tool for every persona as the matrix says', async () => {
		const mismatches: string[] = [];
		for (const tool of tools) {
			const minRole = toolMinRole(tool.name);
			for (const persona of PERSONAS) {
				const expected = minRole ? EXPECTED[persona][minRole] : 'declared';
				const result = await callTool(tool.name, { project: 'acme/roadmap' }, actor(persona), undefined);
				const actual = outcome(tool.name, result);
				if (actual !== expected) mismatches.push(`${tool.name} as ${persona}: expected ${expected}, got ${actual}`);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('resolves a bound project the same way', async () => {
		const binding = { ref: { owner: 'acme', project: 'roadmap' } };
		expect(outcome('update_item', await callTool('update_item', {}, actor('viewer'), binding))).toBe('view access');
		expect(outcome('get_items', await callTool('get_items', {}, actor('viewer'), binding))).toBe('allowed');
		expect(text(await callTool('get_items', {}, actor('nonMember'), binding))).toMatch(/\.mcp\.json binding/);
	});

	it('lists member projects with the caller\'s role', async () => {
		const listed = JSON.parse(text(await callTool('list_projects', {}, actor('editorWithoutGitHub'), undefined))) as {
			projects: Array<Record<string, unknown>>;
		};
		expect(listed.projects).toEqual([
			expect.objectContaining({ ref: 'acme/roadmap', role: 'editor', effectiveRole: 'viewer' }),
		]);
	});

	it('answers a logged-out caller with 401 before any tool runs', async () => {
		for (const tool of tools) {
			const response = await createApp().request(
				'http://localhost/mcp',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool.name, arguments: { project: 'acme/roadmap' } } }),
				},
				{ incoming: { socket: { remoteAddress: '127.0.0.1' } }, outgoing: { headersSent: false, statusCode: 200 } }
			);
			expect(response.status, tool.name).toBe(401);
		}
	});
});
