/**
 * The invitation service against real Postgres (PGlite, every migration applied), so the
 * state rules, the one-open-invitation index and the accept transaction run as SQL:
 * re-inviting revokes, resending rotates the token, answers bind to the invited address,
 * and accepting guards the owner, an existing member and an account without a slug.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('../test-support/pglite-pg.ts')).pgliteAsPg(() => state.db!));

import { migratedDb } from '../test-support/migrated-db.ts';
import {
	acceptInvitation,
	createInvitation,
	declineInvitation,
	getInvitationByTokenHash,
	getInvitationAddress,
	getInvitationForUser,
	listInvitationsForUser,
	listPendingInvitations,
	newerOpenInvitationId,
	resendInvitation,
	revokeInvitation,
	type CreateInvitationInput,
	type IssuedInvitation,
} from './invitations.ts';

let db: PGlite;
let alice: string;
let pat: string;
let vera: string;
let newbie: string;
let unverified: string;
let roadmapId: string;

async function insertUser(slug: string | null, email: string, options: { verified?: boolean; name?: [string, string] } = {}): Promise<string> {
	const result = await db.query<{ id: string }>(
		`INSERT INTO users (username, slug, email, email_verified, first_name, last_name)
		 VALUES ($1, $1, $2, $3, $4, $5) RETURNING id`,
		[slug, email, options.verified ?? true, options.name?.[0] ?? null, options.name?.[1] ?? null]
	);
	return result.rows[0]!.id;
}

function invite(email: string, tokenHash: string, overrides: Partial<CreateInvitationInput> = {}): Promise<Awaited<ReturnType<typeof createInvitation>>> {
	return createInvitation({ projectId: roadmapId, email, role: 'editor', invitedBy: alice, tokenHash, ...overrides });
}

async function issued(email: string, tokenHash: string, overrides: Partial<CreateInvitationInput> = {}): Promise<IssuedInvitation> {
	const result = await invite(email, tokenHash, overrides);
	if (!('issued' in result)) throw new Error(`expected an invitation, got ${JSON.stringify(result)}`);
	return result.issued;
}

/** The id of the invitation issued with hash(label). */
async function idOf(label: string): Promise<string> {
	return (await getInvitationByTokenHash(hash(label), null))!.invitation.id;
}

/** A stand-in token hash, distinct per label. */
function hash(label: string): string {
	return createHash('sha256').update(label).digest('hex');
}

beforeAll(async () => {
	db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	alice = await insertUser('alice', 'alice@example.com', { name: ['Alice', 'Ames'] });
	pat = await insertUser('pat', 'pat@example.com', { name: ['Pat', 'Park'] });
	vera = await insertUser('vera', 'vera@example.com');
	newbie = await insertUser(null, 'newbie@example.com');
	unverified = await insertUser('una', 'una@example.com', { verified: false });

	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM') RETURNING id",
		[alice]
	);
	roadmapId = project.rows[0]!.id;
}, 60_000);

beforeEach(async () => {
	await db.query('DELETE FROM project_invitations');
	await db.query('DELETE FROM project_members');
	await db.query("INSERT INTO project_members (project_id, user_id, role, added_by) VALUES ($1, $2, 'viewer', $3)", [roadmapId, vera, alice]);
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await db.close();
});

describe('inviting', () => {
	it('issues an open invitation that expires in seven days, with what its email needs', async () => {
		const result = await issued('pat@example.com', hash('pat'));

		expect(result.projectName).toBe('Roadmap');
		expect(result.inviterName).toBe('Alice Ames');
		expect(result.invitation).toMatchObject({ email: 'pat@example.com', role: 'editor', invitedBy: 'Alice Ames', state: 'open' });
		const days = (result.invitation.expiresAt.getTime() - result.invitation.createdAt.getTime()) / 86_400_000;
		expect(days).toBeCloseTo(7, 3);

		const stored = await db.query<{ token_hash: string }>('SELECT token_hash FROM project_invitations');
		expect(stored.rows).toEqual([{ token_hash: hash('pat') }]);
	});

	it('refuses the owner\'s address and a member\'s', async () => {
		expect(await invite('alice@example.com', hash('a'))).toEqual({ conflict: 'owner' });
		expect(await invite('vera@example.com', hash('v'))).toEqual({ conflict: 'member' });
		expect((await db.query('SELECT 1 FROM project_invitations')).rows).toHaveLength(0);
	});

	it('invites an address with no account', async () => {
		const result = await issued('stranger@example.com', hash('s'));
		expect(result.invitation.email).toBe('stranger@example.com');
	});

	it('revokes the open invitation when the address is invited again', async () => {
		const first = await issued('pat@example.com', hash('first'));
		const second = await issued('pat@example.com', hash('second'), { role: 'viewer' });

		const pending = await listPendingInvitations(roadmapId);
		expect(pending.map((i) => [i.id, i.role])).toEqual([[second.invitation.id, 'viewer']]);
		expect((await getInvitationByTokenHash(hash('first'), null))?.invitation.state).toBe('revoked');
		expect(first.invitation.id).not.toBe(second.invitation.id);
	});
});

describe('the owner\'s pending list', () => {
	it('lists open and expired invitations, not answered or revoked ones', async () => {
		await issued('pat@example.com', hash('pat'));
		const expired = await issued('old@example.com', hash('old'));
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [expired.invitation.id]);
		const gone = await issued('gone@example.com', hash('gone'));
		await revokeInvitation(roadmapId, gone.invitation.id);
		await issued('newbie@example.com', hash('nb'));
		await declineInvitation(await idOf('nb'), newbie);

		const pending = await listPendingInvitations(roadmapId);
		expect(pending.map((i) => [i.email, i.state])).toEqual([
			['pat@example.com', 'open'],
			['old@example.com', 'expired'],
		]);
	});
});

describe('resending', () => {
	it('rotates the token and restarts the expiry', async () => {
		const sent = await issued('pat@example.com', hash('old'));
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 day' WHERE id = $1", [sent.invitation.id]);

		const resent = await resendInvitation(roadmapId, sent.invitation.id, hash('new'));

		expect(resent?.invitation).toMatchObject({ id: sent.invitation.id, state: 'open' });
		expect(resent!.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
		expect((await getInvitationByTokenHash(hash('old'), null))?.invitation ?? null).toBeNull();
		expect((await getInvitationByTokenHash(hash('new'), null))?.invitation.state).toBe('open');
	});

	it('finds nothing to resend once the invitation is answered, revoked, or on another project', async () => {
		const sent = await issued('pat@example.com', hash('p'));
		expect(await resendInvitation(crypto.randomUUID(), sent.invitation.id, hash('x'))).toBeNull();
		await revokeInvitation(roadmapId, sent.invitation.id);
		expect(await resendInvitation(roadmapId, sent.invitation.id, hash('y'))).toBeNull();
	});
});

describe('revoking', () => {
	it('closes the invitation once', async () => {
		const sent = await issued('pat@example.com', hash('p'));
		expect(await revokeInvitation(roadmapId, sent.invitation.id)).toBe(true);
		expect(await revokeInvitation(roadmapId, sent.invitation.id)).toBe(false);
		expect((await getInvitationByTokenHash(hash('p'), null))?.invitation.state).toBe('revoked');
	});
});

describe('the recipient\'s view', () => {
	it('describes the invitation by token', async () => {
		await issued('pat@example.com', hash('p'));
		expect((await getInvitationByTokenHash(hash('p'), null))?.invitation ?? null).toMatchObject({
			email: 'pat@example.com',
			role: 'editor',
			state: 'open',
			projectName: 'Roadmap',
			projectSlug: 'roadmap',
			ownerSlug: 'alice',
			ownerName: 'Alice Ames',
			inviterName: 'Alice Ames',
		});
		expect((await getInvitationByTokenHash(hash('nope'), null))?.invitation ?? null).toBeNull();
	});

	it('lists a user\'s open, unexpired invitations by their verified address', async () => {
		await issued('pat@example.com', hash('p'));
		const expired = await issued('pat@example.com', hash('p2'), { projectId: await secondProject() });
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [expired.invitation.id]);
		await issued('una@example.com', hash('u'));

		expect((await listInvitationsForUser(pat)).map((i) => i.projectSlug)).toEqual(['roadmap']);
		expect(await listInvitationsForUser(unverified)).toEqual([]);
		expect(await listInvitationsForUser(vera)).toEqual([]);
	});

	it('says in the token lookup whether the viewer may answer it', async () => {
		await issued('pat@example.com', hash('p'));
		expect((await getInvitationByTokenHash(hash('p'), null))?.addressedToViewer).toBeNull();
		expect((await getInvitationByTokenHash(hash('p'), pat))?.addressedToViewer).toBe(true);
		expect((await getInvitationByTokenHash(hash('p'), vera))?.addressedToViewer).toBe(false);
		await issued('una@example.com', hash('u'));
		expect((await getInvitationByTokenHash(hash('u'), unverified))?.addressedToViewer).toBe(false);
	});

	it('gives the invited address by id, for checking a typed sign-in code', async () => {
		await issued('pat@example.com', hash('p'));
		expect(await getInvitationAddress(await idOf('p'))).toBe('pat@example.com');
		expect(await getInvitationAddress(crypto.randomUUID())).toBeNull();
	});

	it('reads an invitation by id only for the account it is addressed to, in any state', async () => {
		const sent = await issued('pat@example.com', hash('p'));
		await issued('una@example.com', hash('u'));
		await revokeInvitation(roadmapId, sent.invitation.id);

		expect(await getInvitationForUser(sent.invitation.id, pat)).toMatchObject({ id: sent.invitation.id, state: 'revoked' });
		expect(await getInvitationForUser(sent.invitation.id, vera)).toBeNull();
		expect(await getInvitationForUser(await idOf('u'), unverified)).toBeNull();
		expect(await getInvitationForUser(crypto.randomUUID(), pat)).toBeNull();
	});

	it('finds the open invitation that replaced a revoked or expired one', async () => {
		const first = await issued('pat@example.com', hash('first'));
		expect(await newerOpenInvitationId(first.invitation.id)).toBeNull();

		const second = await issued('pat@example.com', hash('second'));
		expect(await newerOpenInvitationId(first.invitation.id)).toBe(second.invitation.id);
		expect(await newerOpenInvitationId(second.invitation.id)).toBeNull();

		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [second.invitation.id]);
		expect(await newerOpenInvitationId(first.invitation.id)).toBeNull();
	});
});

async function secondProject(): Promise<string> {
	const existing = await db.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'atlas'");
	if (existing.rows[0]) return existing.rows[0].id;
	const created = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key) VALUES ('Atlas', $1, 'atlas', 'AT') RETURNING id",
		[alice]
	);
	return created.rows[0]!.id;
}

async function memberRole(userId: string): Promise<string | undefined> {
	const result = await db.query<{ role: string }>('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [roadmapId, userId]);
	return result.rows[0]?.role;
}

describe('accepting', () => {
	it('adds the member with the invited role and stamps the invitation, by token or by id', async () => {
		await issued('pat@example.com', hash('p'));
		const result = await acceptInvitation(await idOf('p'), pat);

		expect(result).toMatchObject({ role: 'editor', alreadyMember: false, invitation: { state: 'accepted', ownerSlug: 'alice', projectSlug: 'roadmap' } });
		expect(await memberRole(pat)).toBe('editor');
		const added = await db.query<{ added_by: string }>('SELECT added_by FROM project_members WHERE user_id = $1', [pat]);
		expect(added.rows[0]?.added_by).toBe(alice);

		await db.query('DELETE FROM project_members WHERE user_id = $1', [pat]);
		const byId = await issued('pat@example.com', hash('p2'), { role: 'viewer' });
		expect(await acceptInvitation(byId.invitation.id, pat)).toMatchObject({ role: 'viewer', alreadyMember: false });
	});

	it('refuses an account that doesn\'t hold the invited address, and changes nothing', async () => {
		await issued('pat@example.com', hash('p'));
		expect(await acceptInvitation(await idOf('p'), vera)).toEqual({ refused: 'not_found' });
		expect((await getInvitationByTokenHash(hash('p'), null))?.invitation.state).toBe('open');
	});

	it('refuses an unverified address', async () => {
		await issued('una@example.com', hash('u'));
		expect(await acceptInvitation(await idOf('u'), unverified)).toEqual({ refused: 'not_found' });
		expect(await memberRole(unverified)).toBeUndefined();
	});

	it('says which way an invitation closed', async () => {
		await issued('pat@example.com', hash('p'));
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 minute'");
		expect(await acceptInvitation(await idOf('p'), pat)).toEqual({ refused: 'closed', state: 'expired' });

		const revoked = await issued('pat@example.com', hash('r'));
		await revokeInvitation(roadmapId, revoked.invitation.id);
		expect(await acceptInvitation(await idOf('r'), pat)).toEqual({ refused: 'closed', state: 'revoked' });

		await issued('pat@example.com', hash('a'));
		await acceptInvitation(await idOf('a'), pat);
		expect(await acceptInvitation(await idOf('a'), pat)).toEqual({ refused: 'closed', state: 'accepted' });
		expect(await memberRole(pat)).toBe('editor');
	});

	it('never makes the owner a member', async () => {
		// Invites refuse the owner's address, so this is the owner's address changing after the fact.
		await issued('former-alice@example.com', hash('o'));
		await db.query("UPDATE users SET email = 'former-alice@example.com' WHERE id = $1", [alice]);
		try {
			expect(await acceptInvitation(await idOf('o'), alice)).toEqual({ refused: 'owner' });
			expect(await memberRole(alice)).toBeUndefined();
		} finally {
			await db.query("UPDATE users SET email = 'alice@example.com' WHERE id = $1", [alice]);
		}
	});

	it('keeps an existing member\'s role and still stamps the invitation', async () => {
		// The invitation went to an address Vera only takes on after it was sent.
		await issued('vera-new@example.com', hash('v'), { role: 'editor' });
		await db.query("UPDATE users SET email = 'vera-new@example.com' WHERE id = $1", [vera]);
		try {
			const result = await acceptInvitation(await idOf('v'), vera);
			expect(result).toMatchObject({ role: 'viewer', alreadyMember: true, invitation: { state: 'accepted' } });
			expect(await memberRole(vera)).toBe('viewer');
		} finally {
			await db.query("UPDATE users SET email = 'vera@example.com' WHERE id = $1", [vera]);
		}
	});

	it('refuses an account that hasn\'t onboarded, leaving the invitation open', async () => {
		await issued('newbie@example.com', hash('n'));
		expect(await acceptInvitation(await idOf('n'), newbie)).toEqual({ refused: 'no_slug' });
		expect((await getInvitationByTokenHash(hash('n'), null))?.invitation.state).toBe('open');
	});

	it('finds nothing for an unknown token or id', async () => {
		expect(await acceptInvitation(crypto.randomUUID(), pat)).toEqual({ refused: 'not_found' });
		expect(await acceptInvitation(crypto.randomUUID(), pat)).toEqual({ refused: 'not_found' });
	});
});

describe('declining', () => {
	it('stamps the invitation without adding a member, and needs no slug', async () => {
		await issued('newbie@example.com', hash('n'));
		const result = await declineInvitation(await idOf('n'), newbie);
		expect(result).toMatchObject({ invitation: { state: 'declined' } });
		expect(await memberRole(newbie)).toBeUndefined();
		expect(await declineInvitation(await idOf('n'), newbie)).toEqual({ refused: 'closed', state: 'declined' });
	});

	it('refuses someone it isn\'t addressed to', async () => {
		await issued('pat@example.com', hash('p'));
		expect(await declineInvitation(await idOf('p'), vera)).toEqual({ refused: 'not_found' });
		expect((await getInvitationByTokenHash(hash('p'), null))?.invitation.state).toBe('open');
	});
});
