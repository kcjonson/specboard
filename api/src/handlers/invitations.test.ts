/**
 * Invitations end to end through the real app: the owner's routes behind the gate, the
 * emailed link's lookup, the recipient's routes by id, and signup and sign-in from an
 * invitation, with the real services
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
		createSession: vi.fn(async () => 'csrf'),
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

/** The invitation id the emailed link's lookup reports. */
async function idFor(token: string): Promise<string> {
	return (await call(null, 'GET', `/api/invite?token=${token}`)).body.id as string;
}

function accept(caller: Caller, id: string): ReturnType<typeof call> {
	return call(caller, 'POST', `/api/invitations/${id}/accept`);
}

function decline(caller: Caller, id: string): ReturnType<typeof call> {
	return call(caller, 'POST', `/api/invitations/${id}/decline`);
}

describe('looking up the emailed link', () => {
	it('shows the invite card\'s details with the address masked, and changes nothing', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const response = await call(null, 'GET', `/api/invite?token=${token}`);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
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

	it('says whether it is addressed to the signed-in account, and tells only its recipient the project', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		expect((await call('pat', 'GET', `/api/invite?token=${token}`)).body).toMatchObject({
			addressedToYou: true,
			project: { ref: 'acme/roadmap', name: 'Roadmap' },
		});
		const other = (await call('sam', 'GET', `/api/invite?token=${token}`)).body;
		expect(other).toMatchObject({ addressedToYou: false });
		expect(other).not.toHaveProperty('project');
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

describe('reading an invitation by id', () => {
	it('shows its recipient the card, in any state', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		expect((await call('pat', 'GET', `/api/invitations/${id}`)).body).toMatchObject({ id, state: 'open', addressedToYou: true });

		await decline('pat', id);
		expect((await call('pat', 'GET', `/api/invitations/${id}`)).body).toMatchObject({ id, state: 'declined' });
	});

	it('is 404 to anyone else and 401 signed out', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		expect((await call('sam', 'GET', `/api/invitations/${id}`)).status).toBe(404);
		expect((await call('una', 'GET', `/api/invitations/${id}`)).status).toBe(404);
		expect((await call('sam', 'GET', '/api/invitations/not-a-uuid')).status).toBe(404);
		expect((await call(null, 'GET', `/api/invitations/${id}`)).status).toBe(401);
	});

	it('points the recipient of a replaced invite at the open one', async () => {
		const first = await idFor(await inviteAndGetToken('pat@example.com'));
		const second = await idFor(await inviteAndGetToken('pat@example.com', 'viewer'));

		expect((await call('pat', 'GET', `/api/invitations/${first}`)).body).toMatchObject({ state: 'revoked', openInvitationId: second });
		expect((await call('pat', 'GET', `/api/invitations/${second}`)).body).not.toHaveProperty('openInvitationId');
	});

	it('gives the recipient of an accepted invite the project to open', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		await accept('pat', id);
		const view = (await call('pat', 'GET', `/api/invitations/${id}`)).body;
		expect(view).toMatchObject({ state: 'accepted', project: { ref: 'acme/roadmap' } });
		expect(view).not.toHaveProperty('openInvitationId');
	});
});

describe('accepting and declining', () => {
	it('adds the member with the invited role and answers with the project to open', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const response = await accept('pat', await idFor(token));

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ project: { ref: 'acme/roadmap', name: 'Roadmap' }, role: 'editor', alreadyMember: false });
		expect((await call('pat', 'GET', '/api/projects/acme/roadmap')).status).toBe(200);
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ state: 'accepted' });
	});

	// In the app CSRF answers a session-less POST with 403 before the handler; it is
	// passed through here, so this is the handler's own refusal.
	it('needs a session', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		expect((await accept(null, id)).status).toBe(401);
		expect((await decline(null, id)).status).toBe(401);
	});

	it('refuses a forwarded link: another account gets a 404 and no membership', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		expect((await accept('sam', id)).status).toBe(404);
		expect((await decline('sam', id)).status).toBe(404);
		expect((await call('sam', 'GET', '/api/projects/acme/roadmap')).status).toBe(404);
		expect((await call(null, 'GET', `/api/invitations/${id}`)).status).toBe(401);
	});

	it('refuses an account whose address isn\'t verified', async () => {
		const token = await inviteAndGetToken('una@example.com');
		expect((await accept('una', await idFor(token))).status).toBe(404);
		expect((await call('una', 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ addressedToYou: false });
	});

	it('says an answered, revoked or expired invitation is gone, and which', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		await decline('pat', id);

		const response = await accept('pat', id);
		expect(response.status).toBe(410);
		expect(response.body).toMatchObject({ code: 'INVITATION_CLOSED', state: 'declined' });

		const expired = await inviteAndGetToken('pat@example.com');
		await db.query("UPDATE project_invitations SET expires_at = NOW() - interval '1 second' WHERE token_hash = $1", [hashToken(expired)]);
		expect((await accept('pat', await idFor(expired))).body).toMatchObject({ state: 'expired' });
	});

	it('tells an account that hasn\'t onboarded to finish first, and leaves the invite open', async () => {
		const token = await inviteAndGetToken('newbie@example.com');
		const response = await accept('newbie', await idFor(token));

		expect(response.status).toBe(409);
		expect(response.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).body).toMatchObject({ state: 'open' });
	});

	it('keeps an existing member\'s role', async () => {
		const id = await idFor(await inviteAndGetToken('vera-work@example.com', 'editor'));
		await db.query("UPDATE users SET email = 'vera-work@example.com' WHERE id = $1", [users.vera]);
		try {
			expect((await accept('vera', id)).body).toMatchObject({ role: 'viewer', alreadyMember: true });
		} finally {
			await db.query("UPDATE users SET email = 'vera@example.com' WHERE id = $1", [users.vera]);
		}
	});

	it('refuses to make the owner a member', async () => {
		const id = await idFor(await inviteAndGetToken('acme-old@example.com'));
		await db.query("UPDATE users SET email = 'acme-old@example.com' WHERE id = $1", [users.owner]);
		try {
			const response = await accept('owner', id);
			expect(response.status).toBe(409);
			expect(response.body).toMatchObject({ code: 'PROJECT_OWNER' });
		} finally {
			await db.query("UPDATE users SET email = 'acme@example.com' WHERE id = $1", [users.owner]);
		}
		const members = await db.query('SELECT 1 FROM project_members WHERE user_id = $1', [users.owner]);
		expect(members.rows).toHaveLength(0);
	});

	it('declines without adding a member', async () => {
		const id = await idFor(await inviteAndGetToken('pat@example.com'));
		expect((await decline('pat', id)).status).toBe(200);
		expect((await call('pat', 'GET', '/api/projects/acme/roadmap')).status).toBe(404);
		expect((await call('owner', 'GET', INVITATIONS)).body).toEqual([]);
	});

	it('answers an unknown or malformed id with 404', async () => {
		expect((await accept('pat', crypto.randomUUID())).status).toBe(404);
		expect((await accept('pat', 'not-a-uuid')).status).toBe(404);
		expect((await decline('pat', crypto.randomUUID())).status).toBe(404);
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

	it('accepts by an id from the list, which then drops it', async () => {
		await inviteAndGetToken('pat@example.com', 'viewer');
		const [mine] = (await call('pat', 'GET', '/api/invitations')).body;

		expect((await accept('pat', mine!.id as string)).body).toMatchObject({ project: { ref: 'acme/roadmap' }, role: 'viewer' });
		expect((await call('pat', 'GET', '/api/invitations')).body).toEqual([]);
	});
});

/** The sign-in code in the most recent magic-link email. */
function lastEmailedCode(): string {
	const sent = vi.mocked(sendEmail).mock.calls.at(-1)?.[0];
	const match = sent?.textBody.match(/\b([A-Z2-9]{4})-([A-Z2-9]{4})\b/);
	if (!match) throw new Error('no sign-in code was sent');
	return `${match[1]}${match[2]}`;
}

describe('signing up and in from an invitation', () => {
	it('never stores the raw token: the magic link comes back to the invite by id', async () => {
		const token = await inviteAndGetToken('stranger@example.com');
		const id = await idFor(token);

		const signup = await call(null, 'POST', '/api/auth/signup', { invite_token: token });
		expect(signup.status).toBe(201);
		// The token holder may not own the address, so it only ever sees it masked.
		expect(signup.body.email).toBe('s•••@example.com');

		const stored = await db.query<{ next_path: string }>('SELECT * FROM magic_link_tokens');
		expect(stored.rows.map((row) => row.next_path)).toEqual([`/invite?id=${id}`]);
		expect(JSON.stringify(stored.rows)).not.toContain(token);
		const users = await db.query("SELECT signup_metadata FROM users WHERE email = 'stranger@example.com'");
		expect(JSON.stringify(users.rows)).not.toContain(token);
	});

	it('sends an existing account the same way, with the same masked answer', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const signup = await call(null, 'POST', '/api/auth/signup', { invite_token: token });

		expect(signup.body.email).toBe('p•••@example.com');
		const stored = await db.query<{ next_path: string }>('SELECT next_path FROM magic_link_tokens WHERE user_id = $1', [users.pat]);
		expect(stored.rows).toEqual([{ next_path: `/invite?id=${await idFor(token)}` }]);
	});

	it('checks a typed code against the invited address without the client naming it', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		const id = await idFor(token);
		await call(null, 'POST', '/api/auth/signup', { invite_token: token });
		const code = lastEmailedCode();

		const unknown = await call(null, 'POST', '/api/auth/magic-link/verify', { invitation_id: crypto.randomUUID(), code });
		expect(unknown.status).toBe(401);
		const malformed = await call(null, 'POST', '/api/auth/magic-link/verify', { invitation_id: 'nope', code });
		expect(malformed.status).toBe(401);
		const verified = await call(null, 'POST', '/api/auth/magic-link/verify', { invitation_id: id, code });
		expect(verified.status).toBe(200);
		expect(verified.body).toMatchObject({ next: `/invite?id=${id}` });
	});

	it('still verifies the code when the owner resends the invite mid-signup', async () => {
		const token = await inviteAndGetToken('stranger@example.com');
		const id = await idFor(token);
		await call(null, 'POST', '/api/auth/signup', { invite_token: token });
		const code = lastEmailedCode();

		expect((await call('owner', 'POST', `${INVITATIONS}/${id}/resend`)).status).toBe(200);

		// The old token is dead now, so only the id can name the address.
		expect((await call(null, 'GET', `/api/invite?token=${token}`)).status).toBe(404);
		const verified = await call(null, 'POST', '/api/auth/magic-link/verify', { invitation_id: id, code });
		expect(verified.status).toBe(200);
		expect(verified.body).toMatchObject({ next: `/invite?id=${id}` });
	});

	it('no longer takes an invitation token at verify', async () => {
		const token = await inviteAndGetToken('pat@example.com');
		await call(null, 'POST', '/api/auth/signup', { invite_token: token });
		const response = await call(null, 'POST', '/api/auth/magic-link/verify', { invite_token: token, code: lastEmailedCode() });
		expect(response.status).toBe(400);
	});
});
