/**
 * What an agent reads back about who did what. Actors are stored with the user id, the
 * OAuth client id and the MCP session id, and none of that may reach another person's
 * agent: a viewer reading the board sees only the actor's type, device and client.
 * Run end to end through the real tools and services against PGlite.
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

let owner: AgentActor;
let viewer: AgentActor;

function text(result: ToolResult): string {
	expect(result.isError, result.content[0]?.text).toBeFalsy();
	return result.content.map((part) => part.text).join('\n');
}

/** Everything about the actors that must stay server-side. */
function secrets(): string[] {
	return [owner.userId, viewer.userId, CLIENT_ID, SESSION_ID];
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	// The pool reads its URL before it is built; pg is PGlite underneath, so any value does.
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	const insertUser = async (slug: string): Promise<string> =>
		(await db.query<{ id: string }>('INSERT INTO users (username, slug, email) VALUES ($1, $1, $2) RETURNING id', [slug, `${slug}@example.com`])).rows[0]!.id;
	const ownerId = await insertUser('acme');
	const viewerId = await insertUser('vera');
	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[ownerId]
	);
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [project.rows[0]!.id, viewerId]);

	owner = { type: 'agent', userId: ownerId, clientId: CLIENT_ID, deviceName: 'laptop', sessionId: SESSION_ID, client: { name: 'claude-code', version: '2.0.0' } };
	viewer = { type: 'agent', userId: viewerId, clientId: 'viewer-client', deviceName: 'desk' };

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
	it('gets one item with its notes, children, workers and blockers, and no actor ids', async () => {
		const body = text(await callTool('get_items', {
			project: 'acme/roadmap', item_key: 'RM-1', include_notes: true, include_children: true,
		}, viewer, undefined));

		const [item] = (JSON.parse(body) as { items: Array<Record<string, unknown>> }).items;
		expect(item).toMatchObject({
			key: 'RM-1',
			origin: { actor: { type: 'agent', deviceName: 'laptop', client: { name: 'claude-code', version: '2.0.0' } } },
			notes: [expect.objectContaining({ note: 'Picked this up', actor: { type: 'agent', deviceName: 'laptop', client: { name: 'claude-code', version: '2.0.0' } } })],
			children: [expect.objectContaining({ key: 'RM-2' })],
			workers: [expect.objectContaining({ branch: 'launch', actor: { type: 'agent', deviceName: 'laptop', client: { name: 'claude-code', version: '2.0.0' } } })],
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
