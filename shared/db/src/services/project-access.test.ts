/**
 * resolveProjectAccess, the one path from an owner/project address to a project and the
 * caller's role on it, plus the reads built on the same role rules (getProjects, the
 * member list) and the member writes. Run against real Postgres (PGlite) with every
 * migration applied, so the joins and the effective-role rule are exercised as SQL.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params).then((r) => ({ ...r, rowCount: r.affectedRows })),
	transaction: vi.fn(),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import {
	accessDenial,
	createProject,
	getProject,
	getProjects,
	resolveProjectAccess,
	ProjectOwnerWithoutSlugError,
} from './projects.ts';
import { leaveProject, listProjectMembers, removeProjectMember, setProjectMemberRole } from './members.ts';

let alice: string;
let bob: string;
let erin: string;
let nick: string;
let vera: string;
let sam: string;
let pending: string;
let roadmapId: string;
let globexRoadmapId: string;

async function insertUser(db: PGlite, username: string | null, slug: string | null, name?: [string, string]): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id',
		[username, slug, `${username ?? 'pending'}@example.com`, name?.[0] ?? null, name?.[1] ?? null]
	);
	return result.rows[0]!.id;
}

async function connectGitHub(db: PGlite, userId: string, login: string): Promise<void> {
	await db.query(
		"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, $2, $2, 'token', '{repo}')",
		[userId, login]
	);
}

async function addMember(db: PGlite, projectId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
	await db.query('INSERT INTO project_members (project_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)', [projectId, userId, role, alice]);
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	alice = await insertUser(db, 'alice', 'acme', ['Alice', 'Ames']);
	bob = await insertUser(db, 'bob', 'globex');
	erin = await insertUser(db, 'erin', 'erin', ['Erin', 'Editor']);
	nick = await insertUser(db, 'nick', 'nick');
	vera = await insertUser(db, 'vera', 'vera');
	sam = await insertUser(db, 'sam', 'sam');
	pending = await insertUser(db, null, null);

	const roadmap = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[alice]
	);
	roadmapId = roadmap.rows[0]!.id;
	// Same project slug under another owner: the address, not the slug, picks the project.
	const globex = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[bob]
	);
	globexRoadmapId = globex.rows[0]!.id;

	await connectGitHub(db, erin, 'erin-gh');
	await connectGitHub(db, vera, 'vera-gh');
	await addMember(db, roadmapId, erin, 'editor');
	await addMember(db, roadmapId, nick, 'editor');
	await addMember(db, roadmapId, vera, 'viewer');
	await addMember(db, globexRoadmapId, sam, 'editor');
}, 60_000);

afterAll(async () => {
	await state.db?.close();
});

const ROADMAP = (): object => ({ id: roadmapId, slug: 'roadmap', key: 'RM', ownerSlug: 'acme' });

describe('resolveProjectAccess', () => {
	it('gives the owner owner, granted and effective', async () => {
		expect(await resolveProjectAccess('acme', 'roadmap', alice)).toEqual({
			project: ROADMAP(),
			grantedRole: 'owner',
			effectiveRole: 'owner',
		});
	});

	it('gives an editor with GitHub connected editor', async () => {
		expect(await resolveProjectAccess('acme', 'roadmap', erin)).toEqual({
			project: ROADMAP(),
			grantedRole: 'editor',
			effectiveRole: 'editor',
		});
	});

	it('drops an editor without GitHub to an effective viewer, keeping the grant', async () => {
		expect(await resolveProjectAccess('acme', 'roadmap', nick)).toMatchObject({
			grantedRole: 'editor',
			effectiveRole: 'viewer',
		});
	});

	it('keeps a viewer a viewer even with GitHub connected', async () => {
		expect(await resolveProjectAccess('acme', 'roadmap', vera)).toMatchObject({
			grantedRole: 'viewer',
			effectiveRole: 'viewer',
		});
	});

	it('returns null for someone who is neither owner nor member', async () => {
		// bob owns a project with the same slug, and sam is a member elsewhere: neither reaches this one.
		expect(await resolveProjectAccess('acme', 'roadmap', bob)).toBeNull();
		expect(await resolveProjectAccess('acme', 'roadmap', sam)).toBeNull();
	});

	it('returns null for the right project slug under the wrong owner', async () => {
		// globex/roadmap exists, but neither alice nor her members reach it.
		expect(await resolveProjectAccess('globex', 'roadmap', alice)).toBeNull();
		expect(await resolveProjectAccess('globex', 'roadmap', erin)).toBeNull();
		// and sam's membership there doesn't follow the slug to acme/roadmap
		expect(await resolveProjectAccess('globex', 'roadmap', sam)).toMatchObject({ project: { id: globexRoadmapId } });
	});

	it('returns null for an unknown owner or project', async () => {
		expect(await resolveProjectAccess('initech', 'roadmap', alice)).toBeNull();
		expect(await resolveProjectAccess('acme', 'nope', alice)).toBeNull();
	});
});

describe('accessDenial', () => {
	it.each([
		['owner', 'owner', 'owner', null],
		['editor', 'editor', 'editor', null],
		['editor', 'editor', 'viewer', null],
		['editor', 'editor', 'owner', 'owner_only'],
		['editor', 'viewer', 'editor', 'github_not_connected'],
		['editor', 'viewer', 'viewer', null],
		['viewer', 'viewer', 'editor', 'viewer'],
		['viewer', 'viewer', 'owner', 'owner_only'],
	] as const)('granted %s, effective %s, needing %s: %s', (grantedRole, effectiveRole, minRole, expected) => {
		expect(accessDenial({ grantedRole, effectiveRole }, minRole)).toBe(expected);
	});
});

describe('getProjects', () => {
	it('lists owned and member projects with the caller\'s role and the owner\'s name', async () => {
		expect(await getProjects(erin)).toEqual([
			expect.objectContaining({ id: roadmapId, ownerSlug: 'acme', ownerName: 'Alice Ames', grantedRole: 'editor', effectiveRole: 'editor' }),
		]);
		expect(await getProjects(nick)).toEqual([
			expect.objectContaining({ id: roadmapId, grantedRole: 'editor', effectiveRole: 'viewer' }),
		]);
		const owned = await getProjects(alice);
		expect(owned.map((p) => [p.id, p.grantedRole])).toContainEqual([roadmapId, 'owner']);
		expect(owned.map((p) => p.id)).not.toContain(globexRoadmapId);
	});

	it('falls back to the username when the owner has no name', async () => {
		expect(await getProjects(sam)).toEqual([
			expect.objectContaining({ id: globexRoadmapId, ownerSlug: 'globex', ownerName: 'bob', grantedRole: 'editor', effectiveRole: 'viewer' }),
		]);
	});
});

describe('project responses carry the owner slug', () => {
	it('getProjects and getProject join it in', async () => {
		const listed = (await getProjects(alice)).find((p) => p.id === roadmapId);
		expect(listed).toMatchObject({ slug: 'roadmap', ownerSlug: 'acme' });
		expect(await getProject(roadmapId)).toMatchObject({ slug: 'roadmap', ownerSlug: 'acme' });
	});

	it('createProject returns it from the insert', async () => {
		const created = await createProject(alice, { name: 'Launch Plan' });
		expect(created).toMatchObject({ slug: 'launch-plan', ownerSlug: 'acme' });
		expect(await resolveProjectAccess('acme', 'launch-plan', alice)).toMatchObject({ project: { id: created.id } });
	});

	it('createProject refuses a user without a slug, whose project no address could reach', async () => {
		await expect(createProject(pending, { name: 'Orphan' })).rejects.toBeInstanceOf(ProjectOwnerWithoutSlugError);
	});
});

describe('members', () => {
	it('lists the owner first, then members in join order, with no user ids', async () => {
		const members = await listProjectMembers(roadmapId);
		expect(members).toEqual([
			{ slug: 'acme', name: 'Alice Ames', email: 'alice@example.com', avatarUrl: null, role: 'owner', effectiveRole: 'owner', githubConnected: false },
			{ slug: 'erin', name: 'Erin Editor', email: 'erin@example.com', avatarUrl: null, role: 'editor', effectiveRole: 'editor', githubConnected: true },
			{ slug: 'nick', name: 'nick', email: 'nick@example.com', avatarUrl: null, role: 'editor', effectiveRole: 'viewer', githubConnected: false },
			{ slug: 'vera', name: 'vera', email: 'vera@example.com', avatarUrl: null, role: 'viewer', effectiveRole: 'viewer', githubConnected: true },
		]);
	});

	it('changes a member\'s role and answers with the member view', async () => {
		expect(await setProjectMemberRole(roadmapId, 'vera', 'editor')).toMatchObject({ slug: 'vera', role: 'editor', effectiveRole: 'editor' });
		expect(await resolveProjectAccess('acme', 'roadmap', vera)).toMatchObject({ grantedRole: 'editor', effectiveRole: 'editor' });
		await setProjectMemberRole(roadmapId, 'vera', 'viewer');
	});

	it('changes and removes nobody who isn\'t a member, the owner included', async () => {
		expect(await setProjectMemberRole(roadmapId, 'acme', 'viewer')).toBeNull();
		expect(await setProjectMemberRole(roadmapId, 'sam', 'viewer')).toBeNull();
		expect(await removeProjectMember(roadmapId, 'acme')).toBe(false);
		expect(await removeProjectMember(globexRoadmapId, 'erin')).toBe(false);
		expect(await resolveProjectAccess('acme', 'roadmap', alice)).toMatchObject({ grantedRole: 'owner' });
	});

	it('removes a member, who then can\'t reach the project', async () => {
		await addMember(state.db!, roadmapId, sam, 'viewer');
		expect(await removeProjectMember(roadmapId, 'sam')).toBe(true);
		expect(await resolveProjectAccess('acme', 'roadmap', sam)).toBeNull();
	});

	it('lets a member leave', async () => {
		await addMember(state.db!, roadmapId, sam, 'viewer');
		await leaveProject(roadmapId, sam);
		expect(await resolveProjectAccess('acme', 'roadmap', sam)).toBeNull();
		expect(await resolveProjectAccess('globex', 'roadmap', sam)).not.toBeNull();
	});

	it('goes with the account when the member is deleted', async () => {
		const temp = await insertUser(state.db!, 'temp', 'temp');
		await addMember(state.db!, roadmapId, temp, 'viewer');
		await state.db!.query('DELETE FROM users WHERE id = $1', [temp]);
		expect((await listProjectMembers(roadmapId)).map((m) => m.slug)).not.toContain('temp');
	});
});
