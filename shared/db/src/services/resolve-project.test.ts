/**
 * resolveProject, the one path from an owner/project address to a project, run against
 * real Postgres (PGlite) with every migration applied, so the join and the owner check
 * are exercised as SQL rather than asserted as strings.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: vi.fn(),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import { resolveProject, getProjects, getProject, createProject, ProjectOwnerWithoutSlugError } from './projects.ts';

let alice: string;
let bob: string;
let pending: string;
let roadmapId: string;

async function insertUser(db: PGlite, username: string | null, slug: string | null): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email) VALUES ($1, $2, $3) RETURNING id',
		[username, slug, `${username ?? 'pending'}@example.com`]
	);
	return result.rows[0]!.id;
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	alice = await insertUser(db, 'alice', 'acme');
	bob = await insertUser(db, 'bob', 'globex');
	pending = await insertUser(db, null, null);

	const roadmap = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[alice]
	);
	roadmapId = roadmap.rows[0]!.id;
	// Same project slug under another owner: the address, not the slug, picks the project.
	await db.query("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM')", [bob]);
}, 60_000);

afterAll(async () => {
	await state.db?.close();
});

describe('resolveProject', () => {
	it('resolves an owner/project address for its owner', async () => {
		expect(await resolveProject('acme', 'roadmap', alice)).toEqual({
			id: roadmapId,
			slug: 'roadmap',
			key: 'RM',
			ownerSlug: 'acme',
		});
	});

	it('returns null for the right project slug under the wrong owner', async () => {
		// globex/roadmap exists, but it isn't alice's.
		expect(await resolveProject('globex', 'roadmap', alice)).toBeNull();
	});

	it("returns null for another user's project even at its correct address", async () => {
		expect(await resolveProject('acme', 'roadmap', bob)).toBeNull();
	});

	it('returns null for an unknown owner or project', async () => {
		expect(await resolveProject('initech', 'roadmap', alice)).toBeNull();
		expect(await resolveProject('acme', 'nope', alice)).toBeNull();
	});
});

describe('project responses carry the owner slug', () => {
	it('getProjects and getProject join it in', async () => {
		const [listed] = await getProjects(alice);
		expect(listed).toMatchObject({ slug: 'roadmap', ownerSlug: 'acme' });
		expect(await getProject(roadmapId, alice)).toMatchObject({ slug: 'roadmap', ownerSlug: 'acme' });
	});

	it('createProject returns it from the insert', async () => {
		const created = await createProject(alice, { name: 'Launch Plan' });
		expect(created).toMatchObject({ slug: 'launch-plan', ownerSlug: 'acme' });
		expect(await resolveProject('acme', 'launch-plan', alice)).toMatchObject({ id: created.id });
	});

	it('createProject refuses a user without a slug, whose project no address could reach', async () => {
		await expect(createProject(pending, { name: 'Orphan' })).rejects.toBeInstanceOf(ProjectOwnerWithoutSlugError);
	});
});
