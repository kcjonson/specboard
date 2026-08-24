/**
 * Passkey handler tests — the orchestration obligations the library can't
 * cover: challenge single-use, credential ownership + userHandle, counter
 * write-back, duplicate rejection, challenge/user binding, the login-CSRF
 * origin guard, and ownership scoping on management endpoints.
 * @simplewebauthn/server is mocked here; the ceremony crypto is its own tested
 * surface. Several tests assert the SQL/args, not just the status, so a dropped
 * guard or a swapped INSERT column can't pass silently under a mocked query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { TextEncoder } from 'node:util';

vi.mock('@specboard/db', () => ({ query: vi.fn() }));

vi.mock('@simplewebauthn/server', () => ({
	generateRegistrationOptions: vi.fn(async () => ({ challenge: 'reg-challenge', rp: {}, user: {}, pubKeyCredParams: [] })),
	generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'auth-challenge', rpId: 'localhost', allowCredentials: [] })),
	verifyRegistrationResponse: vi.fn(),
	verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	generateSessionId: vi.fn(() => 'session-id'),
	createSession: vi.fn(async () => 'csrf-token'),
	SESSION_COOKIE_NAME: 'session_id',
	CSRF_COOKIE_NAME: 'csrf_token',
	SESSION_TTL_SECONDS: 3600,
}));

import { query } from '@specboard/db';
import {
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	generateRegistrationOptions,
} from '@simplewebauthn/server';
import type { VerifiedRegistrationResponse } from '@simplewebauthn/server';
import { getSession, createSession } from '@specboard/auth';
import {
	handleWebauthnLoginOptions,
	handleWebauthnLoginVerify,
	handleWebauthnRegisterOptions,
	handleWebauthnRegisterVerify,
	handleListPasskeys,
	handleRenamePasskey,
	handleDeletePasskey,
} from './webauthn.ts';

function mockRedis(challenge: unknown): Redis {
	return {
		getdel: vi.fn(async () => (challenge === undefined ? null : JSON.stringify(challenge))),
		setex: vi.fn(async () => 'OK'),
	} as unknown as Redis;
}

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

const USER_ID = 'user-uuid-123';
const CHALLENGE_ID = 'a'.repeat(32);
const CRED_UUID = '11111111-1111-4111-8111-111111111111'; // RFC-4122 conformant (v4, variant 8)
const MATCHING_USER_HANDLE = Buffer.from(USER_ID).toString('base64url');

/**
 * getSessionUserId now issues `SELECT is_active FROM users` to gate the
 * session-authed endpoints on an active account. Every such test needs that to
 * report active; this wraps a per-test query impl and answers the is_active
 * probe first. Pass `active=false` to simulate a deactivated account.
 */
function mockSessionQueries(
	impl?: (sql: string) => pg.QueryResult,
	active = true
): void {
	vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
		const text = sql as string;
		if (text.includes('SELECT is_active FROM users')) return mockQueryResult([{ is_active: active }]);
		return impl ? impl(text) : mockQueryResult([], 1);
	});
}

const credRow = {
	id: 'cred-row-1',
	user_id: USER_ID,
	credential_id: 'Y3JlZC1pZA',
	public_key: Buffer.from('cose'),
	counter: '5',
	transports: ['internal'],
};

const activeUser = { id: USER_ID, username: 'alice', email: 'a@example.com', first_name: 'A', last_name: 'B', avatar_url: null, is_active: true };

/**
 * AuthenticationResponseJSON-shaped body. Defaults to a userHandle that matches
 * the credential owner (so deeper-path tests reach verify); pass a different
 * value for the mismatch case, or delete the key for the absent case.
 */
function loginBody(userHandle: string | undefined = MATCHING_USER_HANDLE): Record<string, unknown> {
	return {
		challengeId: CHALLENGE_ID,
		response: {
			id: 'Y3JlZC1pZA',
			rawId: 'Y3JlZC1pZA',
			response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'z', userHandle },
			type: 'public-key',
			clientExtensionResults: {},
		},
	};
}

function loginApp(redis: Redis): Hono {
	const app = new Hono();
	app.post('/v', (c) => handleWebauthnLoginVerify(c, redis));
	return app;
}

function post(app: Hono, headers: Record<string, string>, body: unknown): Promise<Response> {
	return Promise.resolve(app.request('http://localhost/v', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	}));
}

describe('handleWebauthnLoginVerify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
			verified: true,
			authenticationInfo: {
				newCounter: 6,
				credentialID: 'Y3JlZC1pZA',
				userVerified: true,
				credentialDeviceType: 'multiDevice',
				credentialBackedUp: true,
				origin: 'http://localhost',
				rpID: 'localhost',
			},
		});
	});

	it('rejects a cross-origin request (login-CSRF guard)', async () => {
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })),
			{ Host: 'localhost', Origin: 'https://evil.example.com' }, loginBody());
		expect(res.status).toBe(403);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects invalid JSON with 400', async () => {
		const res = await post(loginApp(mockRedis(undefined)), {}, '{ not json');
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a body with no response object (400)', async () => {
		const res = await post(loginApp(mockRedis(undefined)), {}, { challengeId: CHALLENGE_ID });
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a response with a non-string id (400)', async () => {
		const res = await post(loginApp(mockRedis(undefined)), {},
			{ challengeId: CHALLENGE_ID, response: { id: 123 } });
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a missing/expired challenge', async () => {
		const res = await post(loginApp(mockRedis(undefined)), {}, loginBody());
		expect(res.status).toBe(401);
	});

	it('rejects a challenge of the wrong ceremony type', async () => {
		const res = await post(loginApp(mockRedis({ type: 'registration', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(401);
	});

	it('rejects an unknown credential', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(401);
	});

	it('rejects a login assertion with no userHandle (discoverable login requires it)', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([credRow]) as never);
		const body = loginBody();
		delete (body.response as { response: Record<string, unknown> }).response.userHandle;
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, body);
		expect(res.status).toBe(401);
		expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
	});

	it('rejects a userHandle that does not match the credential owner', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([credRow]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {},
			loginBody(Buffer.from('some-other-user').toString('base64url')));
		expect(res.status).toBe(401);
		expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
	});

	it('verifies, passes UV/RPID/stored-credential to the library, writes the counter back, and establishes a session', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([credRow]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([activeUser]);
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.user.id).toBe(USER_ID);
		// The library must be handed UV enforcement, the RP ID, the server challenge,
		// and the stored credential (never client-supplied key material).
		expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
			expectedChallenge: 'c',
			expectedRPID: expect.any(String),
			requireUserVerification: true,
			credential: expect.objectContaining({ id: 'Y3JlZC1pZA', counter: 5 }),
		}));
		expect(createSession).toHaveBeenCalledWith(expect.anything(), 'session-id', { userId: USER_ID, authMethod: 'passkey', profileComplete: true });
		const update = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('UPDATE webauthn_credentials SET counter'));
		// CAS bound to the counter read at verify (5): [newCounter, id, oldCounter].
		expect(update?.[1]).toEqual([6, 'cred-row-1', 5]);
		// The write-back is the clone-race protection; lock the compare-and-swap
		// predicate so a dropped/loosened clause can't pass under the mocked query.
		expect(update?.[0]).toContain('counter = $3');
	});

	it('accepts a synced passkey reporting counter 0 on both sides (both-zero path)', async () => {
		vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
			verified: true,
			authenticationInfo: {
				newCounter: 0, credentialID: 'Y3JlZC1pZA', userVerified: true,
				credentialDeviceType: 'multiDevice', credentialBackedUp: true,
				origin: 'http://localhost', rpID: 'localhost',
			},
		});
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([{ ...credRow, counter: '0' }]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([activeUser]);
			if (text.includes('UPDATE webauthn_credentials SET counter')) return mockQueryResult([], 1);
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(200);
		expect(createSession).toHaveBeenCalled();
		const update = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('UPDATE webauthn_credentials SET counter'));
		// Both-zero: CAS WHERE counter = 0 still matches. [newCounter, id, oldCounter].
		expect(update?.[1]).toEqual([0, 'cred-row-1', 0]);
	});

	it('rejects an inactive user after verification', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([credRow]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([{ ...activeUser, is_active: false }]);
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('rejects a counter regression thrown by the library', async () => {
		vi.mocked(verifyAuthenticationResponse).mockRejectedValue(new Error('Response counter value 5 was lower than expected 5'));
		vi.mocked(query).mockResolvedValue(mockQueryResult([credRow]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('treats a no-op counter write-back as a clone anomaly (concurrent race)', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([credRow]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([activeUser]);
			if (text.includes('UPDATE webauthn_credentials SET counter')) return mockQueryResult([], 0); // lost the race
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody());
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});
});

describe('handleWebauthnLoginOptions', () => {
	it('rejects a cross-origin request', async () => {
		const app = new Hono();
		app.post('/o', (c) => handleWebauthnLoginOptions(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request('http://localhost/o', {
			method: 'POST', headers: { Host: 'localhost', Origin: 'https://evil.example.com' },
		}));
		expect(res.status).toBe(403);
	});

	it('returns a challenge for a same-origin request', async () => {
		const app = new Hono();
		app.post('/o', (c) => handleWebauthnLoginOptions(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request('http://localhost/o', {
			method: 'POST', headers: { Host: 'localhost', Origin: 'http://localhost' },
		}));
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(typeof data.challengeId).toBe('string');
		expect(typeof data.options.challenge).toBe('string');
	});
});

describe('handleWebauthnRegisterOptions', () => {
	const regUser = { id: USER_ID, email: 'a@example.com', first_name: 'A', last_name: 'B', username: 'alice' };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({ userId: USER_ID, csrfToken: 'x', createdAt: 0, lastAccessedAt: 0 });
	});

	function optApp(redis: Redis): Hono {
		const app = new Hono();
		app.post('/ro', (c) => handleWebauthnRegisterOptions(c, redis));
		return app;
	}
	function postOpt(app: Hono, headers: Record<string, string>): Promise<Response> {
		return Promise.resolve(app.request('http://localhost/ro', { method: 'POST', headers }));
	}

	it('rejects an unauthenticated caller with 401', async () => {
		const res = await postOpt(optApp(mockRedis(undefined)), {}); // no session cookie
		expect(res.status).toBe(401);
		expect(generateRegistrationOptions).not.toHaveBeenCalled();
	});

	it('builds excludeCredentials and the UUID user handle from the account, pinned to ES256/RS256', async () => {
		mockSessionQueries((text) => {
			if (text.includes('FROM users WHERE id')) return mockQueryResult([regUser]);
			if (text.includes('FROM webauthn_credentials WHERE user_id')) {
				return mockQueryResult([
					{ credential_id: 'existing1', transports: ['internal'] },
					{ credential_id: 'existing2', transports: null },
				]);
			}
			return mockQueryResult([]);
		});
		const res = await postOpt(optApp(mockRedis(undefined)), { Cookie: 'session_id=s' });
		expect(res.status).toBe(200);
		expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
			userID: new TextEncoder().encode(USER_ID),
			supportedAlgorithmIDs: [-7, -257],
			attestationType: 'none',
			excludeCredentials: [
				{ id: 'existing1', transports: ['internal'] },
				{ id: 'existing2', transports: undefined },
			],
		}));
	});
});

describe('handleWebauthnRegisterVerify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({ userId: USER_ID, csrfToken: 'x', createdAt: 0, lastAccessedAt: 0 });
		// Typed (not `as never`) so a future library shape change fails to compile
		// here rather than silently desyncing the mock from the real return value.
		const verified: VerifiedRegistrationResponse = {
			verified: true,
			registrationInfo: {
				fmt: 'none',
				aaguid: '00000000-0000-0000-0000-000000000000',
				credential: { id: 'newcred', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] },
				credentialType: 'public-key',
				attestationObject: new Uint8Array([0]),
				userVerified: true,
				credentialDeviceType: 'multiDevice',
				credentialBackedUp: true,
				origin: 'http://localhost',
				rpID: 'localhost',
			},
		};
		vi.mocked(verifyRegistrationResponse).mockResolvedValue(verified);
		// Default: active account, so getSessionUserId resolves. Tests that need
		// specific query behavior re-call mockSessionQueries with their own impl.
		mockSessionQueries();
	});

	function regApp(redis: Redis): Hono {
		const app = new Hono();
		app.post('/r', (c) => handleWebauthnRegisterVerify(c, redis));
		return app;
	}
	function postReg(app: Hono, body: unknown): Promise<Response> {
		return Promise.resolve(app.request('http://localhost/r', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: 'session_id=s' },
			body: typeof body === 'string' ? body : JSON.stringify(body),
		}));
	}
	const regBody = {
		challengeId: CHALLENGE_ID,
		response: {
			id: 'newcred',
			rawId: 'newcred',
			response: { clientDataJSON: 'x', attestationObject: 'y' },
			type: 'public-key',
			clientExtensionResults: {},
		},
	};

	it('rejects invalid JSON with 400', async () => {
		const res = await postReg(regApp(mockRedis(undefined)), '{ not json');
		expect(res.status).toBe(400);
		expect(verifyRegistrationResponse).not.toHaveBeenCalled();
	});

	it('rejects a body with no response object (400)', async () => {
		const res = await postReg(regApp(mockRedis(undefined)), { challengeId: CHALLENGE_ID });
		expect(res.status).toBe(400);
		expect(verifyRegistrationResponse).not.toHaveBeenCalled();
	});

	it('rejects a challenge bound to a different user', async () => {
		const redis = mockRedis({ type: 'registration', challenge: 'c', userId: 'someone-else' });
		const res = await postReg(regApp(redis), regBody);
		expect(res.status).toBe(400);
		expect(verifyRegistrationResponse).not.toHaveBeenCalled();
	});

	it('inserts the credential with the correct columns and returns 201', async () => {
		mockSessionQueries((text) => {
			if (text.includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '2' }]);
			return mockQueryResult([{ id: 'c1', name: 'Passkey', created_at: new Date() }]);
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(201);
		// Assert the full INSERT param array so a column/value misalignment can't
		// corrupt the table unnoticed under a mocked query.
		const insert = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('INSERT INTO webauthn_credentials'));
		expect(insert?.[1]).toEqual([
			USER_ID, 'newcred', Buffer.from(new Uint8Array([1, 2])), 0,
			['internal'], '00000000-0000-0000-0000-000000000000', 'multiDevice', true, 'Passkey',
		]);
		// And that ES256/RS256 + UV are enforced at verify, not just offered.
		expect(verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
			supportedAlgorithmIDs: [-7, -257],
			expectedRPID: expect.any(String),
			requireUserVerification: true,
		}));
	});

	it('maps a duplicate credential to 409', async () => {
		mockSessionQueries((text) => {
			if (text.includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '0' }]);
			const err = new Error('duplicate key') as Error & { code: string };
			err.code = '23505';
			throw err; // the INSERT
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(409);
	});

	it('rejects registration when the passkey cap is reached', async () => {
		mockSessionQueries((text) => {
			if (text.includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '20' }]);
			return mockQueryResult([], 1);
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(409);
		expect(verifyRegistrationResponse).not.toHaveBeenCalled();
	});

	it('returns a generic error (no library internals) when verification throws', async () => {
		vi.mocked(verifyRegistrationResponse).mockRejectedValue(
			new Error('Unexpected registration response challenge "abc", expected "xyz"')
		);
		mockSessionQueries((text) => {
			if (text.includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '0' }]);
			return mockQueryResult([], 1);
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		const data = await res.json();
		expect(res.status).toBe(400);
		expect(data.error).toBe('Verification failed');
		expect(JSON.stringify(data)).not.toContain('expected');
	});
});

describe('passkey management (ownership scoping)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({ userId: USER_ID, csrfToken: 'x', createdAt: 0, lastAccessedAt: 0 });
		mockSessionQueries(); // active account by default
	});

	it('lists only the caller\'s own passkeys', async () => {
		mockSessionQueries((text) => {
			if (text.includes('FROM webauthn_credentials')) return mockQueryResult([{ id: CRED_UUID, name: 'Passkey' }]);
			return mockQueryResult([], 1);
		});
		const app = new Hono();
		app.get('/c', (c) => handleListPasskeys(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request('http://localhost/c', { headers: { Cookie: 'session_id=s' } }));
		expect(res.status).toBe(200);
		const list = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('FROM webauthn_credentials WHERE user_id'));
		expect(list?.[0]).toContain('WHERE user_id = $1');
		expect(list?.[1]).toEqual([USER_ID]);
	});

	it('rename is scoped by user_id and 404s when not owned', async () => {
		mockSessionQueries((text) => (text.includes('UPDATE webauthn_credentials SET name') ? mockQueryResult([], 0) : mockQueryResult([], 1)));
		const app = new Hono();
		app.patch('/c/:id', (c) => handleRenamePasskey(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request(`http://localhost/c/${CRED_UUID}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'session_id=s' },
			body: JSON.stringify({ name: 'Work key' }),
		}));
		expect(res.status).toBe(404);
		const upd = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('UPDATE webauthn_credentials SET name'));
		expect(upd?.[0]).toContain('user_id');
		expect(upd?.[1]).toEqual(['Work key', CRED_UUID, USER_ID]);
	});

	it('rename rejects an empty name with 400 before any write', async () => {
		const app = new Hono();
		app.patch('/c/:id', (c) => handleRenamePasskey(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request(`http://localhost/c/${CRED_UUID}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'session_id=s' },
			body: JSON.stringify({ name: '   ' }),
		}));
		expect(res.status).toBe(400);
		const upd = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('UPDATE webauthn_credentials SET name'));
		expect(upd).toBeUndefined();
	});

	it('rejects a malformed credential id with 404 and no DB write', async () => {
		const app = new Hono();
		app.delete('/c/:id', (c) => handleDeletePasskey(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request('http://localhost/c/not-a-uuid', {
			method: 'DELETE', headers: { Cookie: 'session_id=s' },
		}));
		expect(res.status).toBe(404);
		const del = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('DELETE FROM webauthn_credentials'));
		expect(del).toBeUndefined();
	});

	it('rejects a deactivated account with 401 before touching credentials', async () => {
		mockSessionQueries(undefined, false); // getSessionUserId sees is_active = false
		const app = new Hono();
		app.delete('/c/:id', (c) => handleDeletePasskey(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request(`http://localhost/c/${CRED_UUID}`, {
			method: 'DELETE', headers: { Cookie: 'session_id=s' },
		}));
		expect(res.status).toBe(401);
		const del = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('DELETE FROM webauthn_credentials'));
		expect(del).toBeUndefined();
	});

	it('delete is scoped by user_id and 404s when not owned', async () => {
		mockSessionQueries((text) => (text.includes('DELETE FROM webauthn_credentials') ? mockQueryResult([], 0) : mockQueryResult([], 1)));
		const app = new Hono();
		app.delete('/c/:id', (c) => handleDeletePasskey(c, mockRedis(undefined)));
		const res = await Promise.resolve(app.request(`http://localhost/c/${CRED_UUID}`, {
			method: 'DELETE', headers: { Cookie: 'session_id=s' },
		}));
		expect(res.status).toBe(404);
		const del = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('DELETE FROM webauthn_credentials'));
		expect(del?.[0]).toContain('user_id');
		expect(del?.[1]).toEqual([CRED_UUID, USER_ID]);
	});
});
