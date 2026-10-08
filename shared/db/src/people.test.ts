/**
 * People on items: actors read back as named people (never user ids), and the assignee,
 * written by slug, checked against the project's owner and members, and taken off a
 * departing member's open items in the transaction that removes them. Run against real
 * Postgres (PGlite) with every migration applied.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('./test-support/pglite-pg.ts')).pgliteAsPg(() => state.db!));

import { migratedDb } from './test-support/migrated-db.ts';
import { AssigneeNotMemberError, createItem, getItems, updateItem } from './services/items.ts';
import { addItemNote, listItemNotes } from './services/notes.ts';
import { leaveProject, removeProjectMember } from './services/members.ts';
import { itemViews, noteViews } from './views.ts';
import type { Actor, UserActor } from './types.ts';

let db: PGlite;
let acme: string;
let erin: string;
let vera: string;
let roadmap: string;
let elsewhere: string;
let actor: UserActor;

const ALICE = { slug: 'acme', name: 'Alice Ames', avatarUrl: 'https://example.com/alice.png' };
const ERIN = { slug: 'erin', name: 'erin', avatarUrl: null };

async function insertUser(slug: string, name?: [string, string], avatarUrl?: string): Promise<string> {
	return (await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email, first_name, last_name, avatar_url) VALUES ($1, $1, $2, $3, $4, $5) RETURNING id',
		[slug, `${slug}@example.com`, name?.[0] ?? null, name?.[1] ?? null, avatarUrl ?? null]
	)).rows[0]!.id;
}

async function addMember(projectId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
	await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, userId, role]);
}

async function newItem(projectId: string, title: string): Promise<number> {
	return (await createItem(projectId, { title, type: 'task', origin: { actor } })).number;
}

async function assigneeOf(projectId: string, number: number): Promise<unknown> {
	return (await getItems({ projectId, itemNumber: number })).items[0]!.assignee;
}

beforeAll(async () => {
	db = await migratedDb();
	state.db = db;
	// The pool reads its URL before it is built; pg is PGlite underneath, so any value does.
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	acme = await insertUser('acme', ['Alice', 'Ames'], ALICE.avatarUrl);
	erin = await insertUser('erin');
	vera = await insertUser('vera');
	roadmap = (await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id", [acme]
	)).rows[0]!.id;
	elsewhere = (await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Elsewhere', $1, 'elsewhere', 'EL') RETURNING id", [acme]
	)).rows[0]!.id;
	actor = { type: 'user', userId: acme };
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await state.db?.close();
});

describe('actor views', () => {
	it('name the person behind user and agent actors, and carry no user id', async () => {
		await addMember(roadmap, erin, 'editor');
		const number = await newItem(roadmap, 'Named');
		const agent: Actor = { type: 'agent', userId: erin, clientId: 'oauth-client', sessionId: 'session-1', deviceName: 'laptop', client: { name: 'claude-code' } };
		await addItemNote(roadmap, number, 'from the agent', agent);
		await addItemNote(roadmap, number, 'from the system', { type: 'system', cause: 'parent_rollup' });

		const [view] = await itemViews((await getItems({ projectId: roadmap, itemNumber: number, includeNotes: true })).items);

		expect(view!.origin).toEqual({ actor: { type: 'user', person: ALICE } });
		expect(view!.notes!.map((note) => note.actor)).toEqual([
			{ type: 'system' },
			{ type: 'agent', person: ERIN, deviceName: 'laptop', client: { name: 'claude-code' } },
		]);
		const json = JSON.stringify(view);
		for (const secret of [acme, erin, 'oauth-client', 'session-1']) expect(json).not.toContain(secret);
	});

	it('read a deleted account as a person of null', async () => {
		const gone = await insertUser('gone');
		const number = await newItem(roadmap, 'Orphaned note');
		await addItemNote(roadmap, number, 'still here', { type: 'user', userId: gone });
		await db.query('DELETE FROM users WHERE id = $1', [gone]);

		const notes = await noteViews((await listItemNotes(roadmap, number))!);

		expect(notes[0]!.actor).toEqual({ type: 'user', person: null });
		expect(JSON.stringify(notes)).not.toContain(gone);
	});
});

describe('assignee', () => {
	let number: number;

	beforeEach(async () => {
		number = await newItem(roadmap, 'Assign me');
	});

	it('starts unassigned, and reads back as the person once assigned', async () => {
		expect(await assigneeOf(roadmap, number)).toBeNull();

		const updated = await updateItem(roadmap, number, { assignee: 'erin' }, actor);

		expect(updated!.assignee).toEqual(ERIN);
		expect(await assigneeOf(roadmap, number)).toEqual(ERIN);
	});

	it('takes the owner', async () => {
		expect((await updateItem(roadmap, number, { assignee: 'acme' }, actor))!.assignee).toEqual(ALICE);
	});

	it('unassigns with null', async () => {
		await updateItem(roadmap, number, { assignee: 'erin' }, actor);
		expect((await updateItem(roadmap, number, { assignee: null }, actor))!.assignee).toBeNull();
	});

	it('refuses anyone who isn\'t the owner or a member, and writes nothing else from the call', async () => {
		await addMember(elsewhere, vera, 'editor');
		for (const slug of ['vera', 'nobody', '']) {
			await expect(updateItem(roadmap, number, { title: 'Renamed', assignee: slug }, actor)).rejects.toBeInstanceOf(AssigneeNotMemberError);
		}
		expect((await getItems({ projectId: roadmap, itemNumber: number })).items[0]).toMatchObject({ title: 'Assign me', assignee: null });
	});

	it('goes when the assignee\'s account does', async () => {
		const temp = await insertUser('temp');
		await addMember(roadmap, temp, 'viewer');
		await updateItem(roadmap, number, { assignee: 'temp' }, actor);
		await db.query('DELETE FROM users WHERE id = $1', [temp]);

		expect(await assigneeOf(roadmap, number)).toBeNull();
	});
});

describe('a departing member', () => {
	it('is unassigned from their open items in that project only, when removed', async () => {
		const sam = await insertUser('sam');
		await addMember(roadmap, sam, 'editor');
		await addMember(elsewhere, sam, 'editor');
		const open = await newItem(roadmap, 'Open');
		const done = await newItem(roadmap, 'Done');
		const owners = await newItem(roadmap, 'The owner\'s');
		const other = await newItem(elsewhere, 'Elsewhere');
		await updateItem(roadmap, open, { assignee: 'sam' }, actor);
		await updateItem(roadmap, done, { assignee: 'sam', status: 'done' }, actor);
		await updateItem(roadmap, owners, { assignee: 'acme' }, actor);
		await updateItem(elsewhere, other, { assignee: 'sam' }, actor);

		expect(await removeProjectMember(roadmap, 'sam')).toBe(true);

		expect(await assigneeOf(roadmap, open)).toBeNull();
		expect(await assigneeOf(roadmap, done)).toMatchObject({ slug: 'sam' });
		expect(await assigneeOf(roadmap, owners)).toEqual(ALICE);
		expect(await assigneeOf(elsewhere, other)).toMatchObject({ slug: 'sam' });
	});

	it('is unassigned from their open items when they leave', async () => {
		const lee = await insertUser('lee');
		await addMember(roadmap, lee, 'viewer');
		const open = await newItem(roadmap, 'Open for lee');
		await updateItem(roadmap, open, { assignee: 'lee' }, actor);

		await leaveProject(roadmap, lee);

		expect(await assigneeOf(roadmap, open)).toBeNull();
		await expect(updateItem(roadmap, open, { assignee: 'lee' }, actor)).rejects.toBeInstanceOf(AssigneeNotMemberError);
	});
});
