/**
 * Invitations end to end through the real app: the owner's routes behind the gate, the
 * emailed link's token routes, and the signed-in user's own list, with the real services
 * on a migrated database (PGlite). Who may call the owner routes is the role matrix's
 * job; this suite covers what they do. Only the edges are stubbed: sessions (the cookie
 * is the user id), the email transport (captured, so tests follow the link like an
 * invitee would), and the rate-limit store (an in-memory counter).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Context, Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({
	db: undefined as PGlite | undefined,
	rateCounts: new Map<string, number>(),
}));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

vi.mock('@specboard/auth', async (importOriginal) => {
	const passThrough = () => async (_context: Context, next: () => Promise<void>): Promise<void> => next();
	return {
		...(await importOriginal<typeof import('@specboard/auth')>()),
		getSession: vi.fn(async (_redis: unknown, id: string) => ({ userId: id, csrfToken: 'csrf', createdAt: 0 })),
		rateLimitMiddleware: passThrough,
		csrfMiddleware: passThrough,
		checkRateLimitKey: vi.fn(async (_redis: unknown, key: string, config: { maxRequests: number }) => {
			const count = state.rateCounts.get(key) ?? 0;
			if (count >= config.maxRequests) return false;
			state.rateCounts.set(key, count + 1);
			return true;
		}),
	};
});

vi.mock('@specboard/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/core')>()),
	logRequest: vi.fn(),
	reportError: vi.fn(async () => {}),
}));

vi.mock('@specboard/email', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/email')>()),
	sendEmail: vi.fn(async () => false),
}));

import { checkRateLimitKey, hashToken, RATE_LIMIT_CONFIGS, SESSION_COOKIE_NAME } from '@specboard/auth';
import { sendEmail } from '@specboard/email';
import { migratedDb } from '@specboard/db/test-support';
import { createApp } from '../app.ts';
import { maskEmail } from './invite.ts';

const INVITATIONS = '/api/projects/acme/roadmap/invitations';

let db: PGlite;
let app: Hono;
const users = {} as Record<'owner' | 'pat' | 'vera' | 'newbie' | 'sam' | 'una', string>;

async function insertUser(slug: string | null, email: string, verified = true): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email, email_verified, first_name, last_name) VALUES ($1, $1, $2, $3, $4, $5) RETURNING id',
		[slug, email, verified, slug ? slug[0]!.toUpperCase() + slug.slice(1) : null, slug ? 'Test' : null]
	);
	return result.rows[0]!.id;
}

beforeAll(async () => {
	db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');

	users.owner = await insertUser('acme', 'acme@example.com');
	users.pat = await insertUser('pat', 'pat@example.com');
	users.vera = await insertUser('vera', 'vera@example.com');
	users.newbie = await insertUser(null, 'newbie@example.com');
	users.sam = await insertUser('sam', 'sam@example.com');
	users.una = await insertUser('una', 'una@example.com', false);

	await db.query("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Roadmap', $1, 'roadmap', 'RM')", [users.owner]);
	app = createApp({} as Redis) as unknown as Hono;
}, 60_000);

beforeEach(async () => {
	vi.clearAllMocks();
	state.rateCounts.clear();
	await db.query('DELETE FROM project_invitations');
	await db.query('DELETE FROM project_members');
	const project = await db.query<{ id: string }>("SELECT id FROM projects WHERE slug = 'roadmap'");
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [project.rows[0]!.id, users.vera]);
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await db.close();
});

type Caller = keyof typeof users | null;

async function call(caller: Caller, method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> & Record<string, unknown>[] }> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (caller) headers.cookie = `${SESSION_COOKIE_NAME}=${users[caller]}`;
	const response = await app.request(`http://localhost${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: response.status, body: await response.json() };
}

/** The token in the most recent invitation email, as the invitee would follow it. */
function lastEmailedToken(): string {
	const sent = vi.mocked(sendEmail).mock.calls.at(-1)?.[0];
	const match = sent?.textBody.match(/\/invite\?token=([a-f0-9]{64})/);
	if (!match) throw new Error('no invitation email was sent');
	return match[1]!;
}

async function inviteAndGetToken(email: string, role: 'editor' | 'viewer' = 'editor'): Promise<string> {
	const response = await call('owner', 'POST', INVITATIONS, { email, role });
	expect(response.status).toBe(201);
	return lastEmailedToken();
}

describe('inviting', () => {
	it('stores only the token\'s hash and emails the link', async () => {
		const response = await call('owner', 'POST', INVITATIONS, { email: ' Pat@Example.com ', role: 'editor' });

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ email: 'pat@example.com', role: 'editor', state: 'open', invitedBy: 'Acme Test' });
		const sent = vi.mocked(sendEmail).mock.calls[0]![0];
		expect(sent.to).toBe('pat@example.com');
		expect(sent.subject).toBe('Acme Test invited you to Roadmap on Specboard');
		const token = lastEmailedToken();
		const stored = await db.query<{ token_hash: string }>('SELECT token_hash FROM project_invitations');
		expect(stored.rows).toEqual([{ token_hash: hashToken(token) }]);
	});

	it('answers the same whether or not the address has an account', async () => {
		const withAccount = await call('owner', 'POST', INVITATIONS, { email: 'pat@example.com', role: 'viewer' });
		const without = await call('owner', 'POST', INVITATIONS, { email: 'nobody@example.com', role: 'viewer' });

		expect(without.status).toBe(withAccount.status);
		expect(Object.keys(without.body).sort()).toEqual(Object.keys(withAccount.body).sort());
		expect(sendEmail).toHaveBeenCalledTimes(2);
	});

	it.each([
		['the owner\'s own address', 'acme@example.com', 'PROJECT_OWNER'],
		['a member\'s address', 'VERA@example.com', 'ALREADY_MEMBER'],
	])('refuses %s with a 409 saying why', async (_what, email, code) => {
		const response = await call('owner', 'POST', INVITATIONS, { email, role: 'editor' });

		expect(response.status).toBe(409);
		expect(response.body).toMatchObject({ code });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it.each([
		['no email', { role: 'editor' }],
		['a malformed email', { email: 'not-an-email', role: 'editor' }],
		['an overlong email', { email: `${'a'.repeat(250)}@example.com`, role: 'editor' }],
		['the owner role', { email: 'pat@example.com', role: 'owner' }],
		['no role', { email: 'pat@example.com' }],
		['a null body', null],
	])('refuses %s with 400', async (_what, body) => {
		const response = await call('owner', 'POST', INVITATIONS, body);
		expect(response.status).toBe(400);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('revokes the old link when the address is invited again', async () => {
		const first = await inviteAndGetToken('pat@example.com');
		const second = await inviteAndGetToken('pat@example.com', 'viewer');

		expect((await call(null, 'GET', `/api/invite?token=${first}`)).body).toMatchObject({ state: 'revoked' });
		expect((await call(null, 'GET', `/api/invite?token=${second}`)).body).toMatchObject({ state: 'open', role: 'viewer' });
		const pending = await call('owner', 'GET', INVITATIONS);
		expect(pending.body).toHaveLength(1);
	});

	it('limits invitation emails per owner, sends and resends together', async () => {
		const { maxRequests } = RATE_LIMIT_CONFIGS.projectInvite;
		for (let index = 0; index < maxRequests - 1; index++) {
			expect((await call('owner', 'POST', INVITATIONS, { email: `p${index}@example.com`, role: 'viewer' })).status).toBe(201);
		}
		const pending = await call('owner', 'GET', INVITATIONS);
		const resend = await call('owner', 'POST', `${INVITATIONS}/${pending.body[0]!.id}/resend`);
		expect(resend.status).toBe(200);

		const refused = await call('owner', 'POST', INVITATIONS, { email: 'one-more@example.com', role: 'viewer' });
		expect(refused.status).toBe(429);
		expect((await call('owner', 'POST', `${INVITATIONS}/${pending.body[0]!.id}/resend`)).status).toBe(429);
		expect(sendEmail).toHaveBeenCalledTimes(maxRequests);
		expect(vi.mocked(checkRateLimitKey).mock.calls.every(([, key]) => key === `ratelimit:project-invite:${users.owner}`)).toBe(true);
	});
});

describe('the pending list, resending and revoking', () => {
	it('lists what is still pending', async () => {
		await inviteAndGetToken('pat@example.com');
		const response = await call('owner', 'GET', INVITATIONS);

		expect(response.status).toBe(200);
		expect(response.body).toEqual([expect.objectContaining({ email: 'pat@example.com', role: 'editor', state: 'open' })]);
	});

	it('resends with a new link and a fresh expiry; the old link stops working', async () => {
		const oldToken = await inviteAndGetToken('pat@example.com');
		await db.query("UPDATE project_invitations SET expires_at = NOW() + interval '1 hour'");
		const [pending] = (await call('owner', 'GET', INVITATIONS)).body;

		const response = await call('owner', 'POST', `${INVITATIONS}/${pending!.id}/resend`);

		expect(response.status).toBe(200);
		expect(new Date(response.body.expiresAt as string).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
		const newToken = lastEmailedToken();
		expect(newToken).not.toBe(oldToken);
		expect((await call(null, 'GET', `/api/invite?token=${oldToken}`)).status).toBe(404);
		expect((await call(null, 'GET', `/api/invite?token=${newToken}`)).body).toMatchObject({ state: 'open' });
	});

	it('revokes once, then finds nothing pending', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const [pending] = (await call('owner', 'GET', INVITATIONS)).body;

		expect((await call('owner', 'DELETE', `${INVITATIONS}/${pending!.id}`)).status).toBe(200);
		expect((await call('owner', 'DELETE', `${INVITATIONS}/${pending!.id}`)).status).toBe(404);
		expect((await call('owner', 'POST', `${INVITATIONS}/${pending!.id}/resend`)).status).toBe(404);
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ state: 'revoked' });
	});

	it('answers 404 for an id that isn\'t one', async () => {
		expect((await call('owner', 'DELETE', `${INVITATIONS}/not-a-uuid`)).status).toBe(404);
		expect((await call('owner', 'POST', `${INVITATIONS}/not-a-uuid/resend`)).status).toBe(404);
	});
});

describe('looking up the emailed link', () => {
	it('shows the invite card\'s details with the address masked, and changes nothing', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const response = await call(null, 'GET', `/api/invite?token=${token}`);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			state: 'open',
			role: 'editor',
			projectName: 'Roadmap',
			ownerName: 'Acme Test',
			inviterName: 'Acme Test',
			email: 'p•••@example.com',
			addressedToYou: null,
		});
		const row = await db.query('SELECT 1 FROM project_invitations WHERE accepted_at IS NULL AND declined_at IS NULL');
		expect(row.rows).toHaveLength(1);
	});

	it('says whether it is addressed to the signed-in account', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		expect((await call('pat', 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ addressedToYou: true });
		expect((await call('sam', 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ addressedToYou: false });
	});

	it('answers an unknown or malformed token with 404', async () => {
		expect((await call(null, 'GET', `/api/invite?token=${'a'.repeat(64)}`)).status).toBe(404);
		expect((await call(null, 'GET', '/api/invite?token=short')).status).toBe(404);
		expect((await call(null, 'GET', '/api/invite')).status).toBe(404);
	});

	it('masks an address to its first character and domain', () => {
		expect(maskEmail('kevin@example.com')).toBe('k•••@example.com');
	});
});

describe('accepting and declining by token', () => {
	it('adds the member with the invited role and answers with the project to open', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const response = await call('pat', 'POST', '/api/invite/accept', { token });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ project: { ref: 'acme/roadmap', name: 'Roadmap' }, role: 'editor', alreadyMember: false });
		expect((await call('pat', 'GET', '/api/projects/acme/roadmap')).status).toBe(200);
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ state: 'accepted' });
	});

	it('needs a session', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		expect((await call(null, 'POST', '/api/invite/accept', { token })).status).toBe(401);
		expect((await call(null, 'POST', '/api/invite/decline', { token })).status).toBe(401);
	});

	it('refuses a forwarded link: another account gets a 403 and no membership', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const response = await call('sam', 'POST', '/api/invite/accept', { token });

		expect(response.status).toBe(403);
		expect(response.body).toMatchObject({ code: 'WRONG_ACCOUNT' });
		expect((await call('sam', 'GET', '/api/projects/acme/roadmap')).status).toBe(404);
	});

	it('refuses an account whose address isn\'t verified', async () => {
		const token = await inviteAndGetToken('una@example.com');
		expect((await call('una', 'POST', '/api/invite/accept', { token })).status).toBe(403);
		expect((await call('una', 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ addressedToYou: false });
	});

	it('says an answered, revoked or expired invitation is gone, and which', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		await call('pat', 'POST', '/api/invite/decline', { token });

		const response = await call('pat', 'POST', '/api/invite/accept', { token });
		expect(response.status).toBe(410);
		expect(response.body).toMatchObject({ code: 'INVITATION_CLOSED', state: 'declined' });

		const expired = await inviteAndGetToken('pat@example.com');
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 second' WHERE token_hash = $1", [hashToken(expired)]);
		expect((await call('pat', 'POST', '/api/invite/accept', { token: expired })).body).toMatchObject({ state: 'expired' });
	});

	it('tells an account that hasn\'t onboarded to finish first, and leaves the invite open', async () => {
		const token = await inviteAndGetToken('newbie@example.com');
		const response = await call('newbie', 'POST', '/api/invite/accept', { token });

		expect(response.status).toBe(409);
		expect(response.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ state: 'open' });
	});

	it('keeps an existing member\'s role', async () => {
		const token = await inviteAndGetToken('vera-work@example.com', 'editor');
		await db.query("UPDATE users SET email = 'vera-work@example.com' WHERE id = $1", [users.vera]);
		try {
			const response = await call('vera', 'POST', '/api/invite/accept', { token });
			expect(response.body).toMatchObject({ role: 'viewer', alreadyMember: true });
		} finally {
			await db.query("UPDATE users SET email = 'vera@example.com' WHERE id = $1", [users.vera]);
		}
	});

	it('refuses to make the owner a member', async () => {
		const token = await inviteAndGetToken('acme-old@example.com');
		await db.query("UPDATE users SET email = 'acme-old@example.com' WHERE id = $1", [users.owner]);
		try {
			const response = await call('owner', 'POST', '/api/invite/accept', { token });
			expect(response.status).toBe(409);
			expect(response.body).toMatchObject({ code: 'PROJECT_OWNER' });
		} finally {
			await db.query("UPDATE users SET email = 'acme@example.com' WHERE id = $1", [users.owner]);
		}
		const members = await db.query('SELECT 1 FROM project_members WHERE user_id = $1', [users.owner]);
		expect(members.rows).toHaveLength(0);
	});

	it('declines without adding a member', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		expect((await call('pat', 'POST', '/api/invite/decline', { token })).status).toBe(200);
		expect((await call('pat', 'GET', '/api/projects/acme/roadmap')).status).toBe(404);
		expect((await call('owner', 'GET', INVITATIONS)).body).toEqual([]);
	});

	it('answers a missing or malformed token with 404', async () => {
		expect((await call('pat', 'POST', '/api/invite/accept', {})).status).toBe(404);
		expect((await call('pat', 'POST', '/api/invite/accept', { token: 'nope' })).status).toBe(404);
		expect((await call('pat', 'POST', '/api/invite/decline', { token: 'f'.repeat(64) })).status).toBe(404);
	});
});

describe('the signed-in user\'s own invitations', () => {
	it('lists open invitations addressed to them, without other people\'s', async () => {
		await inviteAndGetToken('pat@example.com');
		await inviteAndGetToken('sam@example.com');

		const response = await call('pat', 'GET', '/api/invitations');

		expect(response.status).toBe(200);
		expect(response.body).toEqual([expect.objectContaining({
			role: 'editor',
			project: { ref: 'acme/roadmap', name: 'Roadmap' },
			ownerName: 'Acme Test',
			inviterName: 'Acme Test',
		})]);
		expect(response.body[0]).not.toHaveProperty('email');
		expect((await call(null, 'GET', '/api/invitations')).status).toBe(401);
	});

	it('accepts and declines by id', async () => {
		await inviteAndGetToken('pat@example.com', 'viewer');
		const [mine] = (await call('pat', 'GET', '/api/invitations')).body;

		const accepted = await call('pat', 'POST', `/api/invitations/${mine!.id}/accept`);
		expect(accepted.body).toMatchObject({ project: { ref: 'acme/roadmap' }, role: 'viewer' });
		expect((await call('pat', 'GET', '/api/invitations')).body).toEqual([]);

		await inviteAndGetToken('sam@example.com');
		const [samInvite] = (await call('sam', 'GET', '/api/invitations')).body;
		expect((await call('sam', 'POST', `/api/invitations/${samInvite!.id}/decline`)).status).toBe(200);
	});

	it('answers someone else\'s invitation id as not found', async () => {
		await inviteAndGetToken('pat@example.com');
		const [patInvite] = (await call('pat', 'GET', '/api/invitations')).body;

		const response = await call('sam', 'POST', `/api/invitations/${patInvite!.id}/accept`);
		expect(response.status).toBe(404);
		expect((await call('sam', 'POST', `/api/invitations/${patInvite!.id}/decline`)).status).toBe(404);
		expect((await call('sam', 'POST', '/api/invitations/not-a-uuid/accept')).status).toBe(404);
	});
});
