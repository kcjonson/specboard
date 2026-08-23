/**
 * Passkey handler tests — the orchestration obligations the verifier can't
 * cover: challenge single-use, credential ownership + userHandle, counter
 * write-back, duplicate rejection, challenge/user binding, and the login-CSRF
 * origin guard. The verifier itself is mocked here; it's tested in @specboard/auth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({ query: vi.fn() }));

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	verifyRegistration: vi.fn(),
	verifyAuthentication: vi.fn(),
	generateSessionId: vi.fn(() => 'session-id'),
	createSession: vi.fn(async () => 'csrf-token'),
	fromBase64url: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
	toBase64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
	SESSION_COOKIE_NAME: 'session_id',
	CSRF_COOKIE_NAME: 'csrf_token',
	SESSION_TTL_SECONDS: 3600,
}));

import { query } from '@specboard/db';
import { getSession, verifyAuthentication, verifyRegistration, createSession } from '@specboard/auth';
import {
	handleWebauthnLoginOptions,
	handleWebauthnLoginVerify,
	handleWebauthnRegisterVerify,
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

const credRow = {
	id: 'cred-row-1',
	user_id: USER_ID,
	credential_id: 'Y3JlZC1pZA',
	public_key: Buffer.from('cose'),
	counter: '5',
	transports: ['internal'],
};

const activeUser = { id: USER_ID, username: 'alice', email: 'a@example.com', first_name: 'A', last_name: 'B', avatar_url: null, is_active: true };

function loginApp(redis: Redis): Hono {
	const app = new Hono();
	app.post('/v', (c) => handleWebauthnLoginVerify(c, redis));
	return app;
}

function post(app: Hono, headers: Record<string, string>, body: unknown): Promise<Response> {
	return Promise.resolve(app.request('http://localhost/v', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	}));
}

const loginBody = {
	challengeId: CHALLENGE_ID,
	id: 'Y3JlZC1pZA',
	clientDataJSON: 'x', authenticatorData: 'y', signature: 'z',
};

describe('handleWebauthnLoginVerify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(verifyAuthentication).mockReturnValue({ newCounter: 6, userVerified: true });
	});

	it('rejects a cross-origin request (login-CSRF guard)', async () => {
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })),
			{ Host: 'localhost', Origin: 'https://evil.example.com' }, loginBody);
		expect(res.status).toBe(403);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a missing/expired challenge', async () => {
		const res = await post(loginApp(mockRedis(undefined)), {}, loginBody);
		expect(res.status).toBe(401);
	});

	it('rejects a challenge of the wrong ceremony type', async () => {
		const res = await post(loginApp(mockRedis({ type: 'registration', challenge: 'c' })), {}, loginBody);
		expect(res.status).toBe(401);
	});

	it('rejects an unknown credential', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody);
		expect(res.status).toBe(401);
	});

	it('rejects a userHandle that does not match the credential owner', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([credRow]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {},
			{ ...loginBody, userHandle: Buffer.from('some-other-user').toString('base64url') });
		expect(res.status).toBe(401);
		expect(verifyAuthentication).not.toHaveBeenCalled();
	});

	it('verifies, writes the counter back, and establishes a session', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([credRow]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([activeUser]);
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {},
			{ ...loginBody, userHandle: Buffer.from(USER_ID).toString('base64url') });
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.user.id).toBe(USER_ID);
		expect(createSession).toHaveBeenCalledWith(expect.anything(), 'session-id', { userId: USER_ID, authMethod: 'passkey', profileComplete: true });
		const update = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('UPDATE webauthn_credentials SET counter'));
		expect(update?.[1]).toEqual([6, 'cred-row-1']);
	});

	it('rejects an inactive user after verification', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('FROM webauthn_credentials WHERE credential_id')) return mockQueryResult([credRow]);
			if (text.includes('FROM users WHERE id')) return mockQueryResult([{ ...activeUser, is_active: false }]);
			return mockQueryResult([], 1);
		});
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody);
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('rejects a counter regression from the verifier', async () => {
		vi.mocked(verifyAuthentication).mockImplementation(() => { throw new Error('signature counter did not increase'); });
		vi.mocked(query).mockResolvedValue(mockQueryResult([credRow]) as never);
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody);
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
		const res = await post(loginApp(mockRedis({ type: 'authentication', challenge: 'c' })), {}, loginBody);
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

describe('handleWebauthnRegisterVerify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({ userId: USER_ID, csrfToken: 'x', createdAt: 0, lastAccessedAt: 0 });
		vi.mocked(verifyRegistration).mockReturnValue({
			credentialId: 'newcred', publicKeyCose: new Uint8Array([1, 2]), counter: 0,
			aaguid: null, deviceType: 'multiDevice', backedUp: true,
		});
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
			body: JSON.stringify(body),
		}));
	}
	const regBody = { challengeId: CHALLENGE_ID, clientDataJSON: 'x', attestationObject: 'y' };

	it('rejects a challenge bound to a different user', async () => {
		const redis = mockRedis({ type: 'registration', challenge: 'c', userId: 'someone-else' });
		const res = await postReg(regApp(redis), regBody);
		expect(res.status).toBe(400);
		expect(verifyRegistration).not.toHaveBeenCalled();
	});

	it('inserts the credential and returns 201', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '2' }]);
			return mockQueryResult([{ id: 'c1', name: 'Passkey', created_at: new Date() }]);
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(201);
		const insert = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('INSERT INTO webauthn_credentials'));
		expect(insert).toBeDefined();
	});

	it('maps a duplicate credential to 409', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '0' }]);
			const err = new Error('duplicate key') as Error & { code: string };
			err.code = '23505';
			throw err; // the INSERT
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(409);
	});

	it('rejects registration when the passkey cap is reached', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT COUNT(*)')) return mockQueryResult([{ count: '20' }]);
			return mockQueryResult([], 1);
		});
		const res = await postReg(regApp(mockRedis({ type: 'registration', challenge: 'c', userId: USER_ID })), regBody);
		expect(res.status).toBe(409);
		expect(verifyRegistration).not.toHaveBeenCalled();
	});
});

describe('handleDeletePasskey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({ userId: USER_ID, csrfToken: 'x', createdAt: 0, lastAccessedAt: 0 });
	});

	function delApp(redis: Redis): Hono {
		const app = new Hono();
		app.delete('/c/:id', (c) => handleDeletePasskey(c, redis));
		return app;
	}

	it('returns 404 when the credential is not owned by the caller', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([], 0) as never);
		const res = await Promise.resolve(delApp(mockRedis(undefined)).request('http://localhost/c/other-cred', {
			method: 'DELETE', headers: { Cookie: 'session_id=s' },
		}));
		expect(res.status).toBe(404);
		// The DELETE must be scoped by user_id.
		const del = vi.mocked(query).mock.calls.find((c) => (c[0] as string).includes('DELETE FROM webauthn_credentials'));
		expect(del?.[0]).toContain('user_id');
	});
});
