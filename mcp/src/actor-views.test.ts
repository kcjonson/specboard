/**
 * What an agent reads back about who did what, and who an item is assigned to. Actors
 * are stored with the user id, the OAuth client id and the MCP session id, and none of
 * that may reach another person's agent: a viewer reading the board sees the actor's
 * type, the person by name and slug, device and client. Assignees are written and read
 * by slug. Run end to end through the real tools and services against PGlite.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { AgentActor } from '@specboard/db';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

import { migratedDb } from '@specboard/db/test-support';
import { callTool } from './tools/index.ts';
import type { ToolResult } from './tools/project-ref.ts';

const SESSION_ID = '7d5c2a3e-9b1f-4c6d-8e2a-1f3b5c7d9e0a';
const CLIENT_ID = 'oauth-client-0f9e8d7c';

let db: PGlite;
let owner: AgentActor;
let viewer: AgentActor;
let editor: AgentActor;
let outsiderId: string;

function text(result: ToolResult): string {
	expect(result.isError, result.content[0]?.text).toBeFalsy();
	return result.content.map((part) => part.text).join('\n');
}

/** Everything about the actors that must stay server-side. */
function secrets(): string[] {
	return [owner.userId, viewer.userId, editor.userId, outsiderId, CLIENT_ID, SESSION_ID];
}

const ALICE = { slug: 'acme', name: 'Alice Ames', avatarUrl: null };
const ERIN = { slug: 'erin', name: 'erin', avatarUrl: null };

/** One item as get_items reads it back. */
async function readItem(key: string, as: AgentActor = viewer): Promise<{ body: string; item: Record<string, unknown> }> {
	const body = text(await callTool('get_items', { project: 'acme/roadmap', item_key: key, include_notes: true }, as, undefined));
	return { body, item: (JSON.parse(body) as { items: Array<Record<string, unknown>> }).items[0]! };
}

beforeAll(async () => {
	db = await migratedDb();
	state.db = db;
	// The pool reads its URL before it is built; pg is PGlite underneath, so any value does.
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	const insertUser = async (slug: string, name?: [string, string]): Promise<string> =>
		(await db.query<{ id: string }>(
			'INSERT INTO users (username, slug, email, first_name, last_name) VALUES ($1, $1, $2, $3, $4) RETURNING id',
			[slug, `${slug}@example.com`, name?.[0] ?? null, name?.[1] ?? null]
		)).rows[0]!.id;
	const ownerId = await insertUser('acme', ['Alice', 'Ames']);
	const viewerId = await insertUser('vera');
	const editorId = await insertUser('erin');
	outsiderId = await insertUser('sam');
	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[ownerId]
	);
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [project.rows[0]!.id, viewerId]);
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')", [project.rows[0]!.id, editorId]);
	await db.query("INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, 'erin-gh', 'erin-gh', 'token', '{repo}')", [editorId]);
	// The outsider is a member somewhere else, which doesn't make them assignable here.
	const elsewhere = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Elsewhere', $1, 'elsewhere', 'EL') RETURNING id",
		[editorId]
	);
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')", [elsewhere.rows[0]!.id, outsiderId]);

	owner = { type: 'agent', userId: ownerId, clientId: CLIENT_ID, deviceName: 'laptop', sessionId: SESSION_ID, client: { name: 'claude-code', version: '2.0.0' } };
	viewer = { type: 'agent', userId: viewerId, clientId: 'viewer-client', deviceName: 'desk' };
	editor = { type: 'agent', userId: editorId, clientId: 'editor-client', deviceName: 'studio' };

	// The owner's agent files an epic with a child, starts it (a worker episode), logs a
	// note, and blocks it on a text reason, so every kind of actor is on the board.
	const project_ = 'acme/roadmap';
	text(await callTool('create_item', { project: project_, title: 'Launch', type: 'epic' }, owner, undefined));
	text(await callTool('create_items', { project: project_, parent_key: 'RM-1', items: [{ title: 'Write the post' }] }, owner, undefined));
	text(await callTool('update_item', {
		project: project_, item_key: 'RM-1', sub_status: 'in_development', note: 'Picked this up', branch_name: 'launch',
	}, owner, undefined));
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

describe('a viewer\'s agent reading the board', () => {
	it('gets one item with its notes, children, workers and blockers, named, and no actor ids', async () => {
		const body = text(await callTool('get_items', {
			project: 'acme/roadmap', item_key: 'RM-1', include_notes: true, include_children: true,
		}, viewer, undefined));

		const [item] = (JSON.parse(body) as { items: Array<Record<string, unknown>> }).items;
		const actor = { type: 'agent', person: ALICE, deviceName: 'laptop', client: { name: 'claude-code', version: '2.0.0' } };
		expect(item).toMatchObject({
			key: 'RM-1',
			origin: { actor },
			notes: [expect.objectContaining({ note: 'Picked this up', actor })],
			children: [expect.objectContaining({ key: 'RM-2' })],
			workers: [expect.objectContaining({ branch: 'launch', actor })],
			assignee: null,
		});
		for (const secret of secrets()) expect(body).not.toContain(secret);
	});

	it('gets a listing with notes and children and no actor ids', async () => {
		const body = text(await callTool('get_items', { project: 'acme/roadmap', include_notes: true, include_children: true }, viewer, undefined));

		expect(body).toContain('Picked this up');
		for (const secret of secrets()) expect(body).not.toContain(secret);
	});
});

describe('write tools answer with views too', () => {
	it('returns blockers set by update_item without who set them', async () => {
		const body = text(await callTool('update_item', {
			project: 'acme/roadmap', item_key: 'RM-2', blockers: [{ text: 'waiting on legal' }],
		}, owner, undefined));

		expect(body).toContain('waiting on legal');
		expect(body).not.toMatch(/createdBy|clearedBy/);
		for (const secret of secrets()) expect(body).not.toContain(secret);
	});

	it('returns blockers set by create_item without who set them', async () => {
		const body = text(await callTool('create_item', {
			project: 'acme/roadmap', title: 'Press kit', type: 'task', blockers: [{ item_key: 'RM-2' }],
		}, owner, undefined));

		expect(body).toContain('RM-2');
		for (const secret of secrets()) expect(body).not.toContain(secret);
	});

	it('answers a blocker naming no item in the project as not found', async () => {
		const result = await callTool('update_item', { project: 'acme/roadmap', item_key: 'RM-2', blockers: [{ item_key: 'RM-99' }] }, owner, undefined);

		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toBe('Blocker item not found');
	});
});

describe('an actor whose account was deleted', () => {
	it('reads as a person of null, keeping the device and client', async () => {
		const goneId = (await db.query<{ id: string }>("INSERT INTO users (username, slug, email) VALUES ('gone', 'gone', 'gone@example.com') RETURNING id")).rows[0]!.id;
		await db.query("INSERT INTO project_members (project_id, user_id, role) SELECT id, $1, 'editor' FROM projects WHERE slug = 'roadmap' AND key = 'RM'", [goneId]);
		await db.query("INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, 'gone-gh', 'gone-gh', 'token', '{repo}')", [goneId]);
		const gone: AgentActor = { type: 'agent', userId: goneId, clientId: 'gone-client', deviceName: 'old-laptop' };
		const created = JSON.parse(text(await callTool('create_item', { project: 'acme/roadmap', title: 'Left behind', type: 'task' }, gone, undefined))) as { created: { key: string } };
		text(await callTool('update_item', { project: 'acme/roadmap', item_key: created.created.key, note: 'Last words' }, gone, undefined));
		await db.query('DELETE FROM users WHERE id = $1', [goneId]);

		const { body, item } = await readItem(created.created.key);

		expect(item).toMatchObject({
			origin: { actor: { type: 'agent', person: null, deviceName: 'old-laptop' } },
			notes: [expect.objectContaining({ note: 'Last words', actor: { type: 'agent', person: null, deviceName: 'old-laptop' } })],
		});
		expect(body).not.toContain(goneId);
	});
});

describe('assignee', () => {
	let key: string;

	beforeAll(async () => {
		const created = JSON.parse(text(await callTool('create_item', { project: 'acme/roadmap', title: 'Ship it', type: 'task' }, owner, undefined))) as { created: { key: string } };
		key = created.created.key;
	});

	it('assigns a member by slug and reads back as the person, with no user id', async () => {
		const body = text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: 'erin' }, editor, undefined));
		expect((JSON.parse(body) as { updated: Record<string, unknown> }).updated).toMatchObject({ key, assignee: ERIN });

		const read = await readItem(key);
		expect(read.item.assignee).toEqual(ERIN);
		for (const secret of secrets()) expect(read.body + body).not.toContain(secret);
	});

	it('assigns the owner', async () => {
		text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: 'acme' }, editor, undefined));
		expect((await readItem(key)).item.assignee).toEqual(ALICE);
	});

	it('carries the assignment through a status shortcut', async () => {
		const body = text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, status: 'in_progress', assignee: 'erin' }, editor, undefined));
		expect((JSON.parse(body) as { updated: Record<string, unknown> }).updated).toMatchObject({ status: 'in_progress', assignee: ERIN });
	});

	it('refuses someone who isn\'t on the project, a member elsewhere included, and leaves the assignee alone', async () => {
		for (const slug of ['sam', 'nobody']) {
			const result = await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: slug, title: 'Renamed' }, editor, undefined);
			expect(result.isError).toBe(true);
			expect(result.content[0]!.text).toBe(`${slug} is not the owner or a member of this project`);
		}
		expect((await readItem(key)).item).toMatchObject({ title: 'Ship it', assignee: ERIN });
	});

	it('refuses a call naming someone not on the project before its move, so nothing changes', async () => {
		const result = await callTool('update_item', { project: 'acme/roadmap', item_key: key, parent_key: 'RM-1', assignee: 'sam' }, editor, undefined);

		expect(result.isError).toBe(true);
		expect((await readItem(key)).item).toMatchObject({ parentKey: null, assignee: ERIN });
	});

	it('refuses a call with any bad argument before its move, too, in its own words', async () => {
		const bads = [
			{ specs: [{ path: 'no-slash.md', type: 'product' }] }, { checklist: [{ text: '' }] }, { checklist_status: { x: 'maybe' } },
			{ status: 'bogus' }, { sub_status: 'nah' }, { title: 'x'.repeat(300) }, { branch_name: 'b'.repeat(256) },
		];
		for (const bad of bads) {
			const result = await callTool('update_item', { project: 'acme/roadmap', item_key: key, parent_key: 'RM-1', ...bad }, editor, undefined);
			expect(result.isError, JSON.stringify(bad)).toBe(true);
			// The tool's own words, never the database's.
			expect(result.content[0]!.text).not.toMatch(/constraint|violates|varchar|character varying/i);
		}
		expect((await readItem(key)).item.parentKey).toBeNull();
	});

	it('refuses an assignee that isn\'t a slug', async () => {
		const result = await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: 42 }, editor, undefined);
		expect(result.isError).toBe(true);
	});

	it('refuses a viewer\'s agent', async () => {
		const result = await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: 'vera' }, viewer, undefined);
		expect(result.isError).toBe(true);
		expect((await readItem(key)).item.assignee).toEqual(ERIN);
	});

	it('unassigns with null and with an empty string', async () => {
		text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: null }, editor, undefined));
		expect((await readItem(key)).item.assignee).toBeNull();
		text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: 'acme' }, editor, undefined));
		text(await callTool('update_item', { project: 'acme/roadmap', item_key: key, assignee: '' }, editor, undefined));
		expect((await readItem(key)).item.assignee).toBeNull();
	});
});
