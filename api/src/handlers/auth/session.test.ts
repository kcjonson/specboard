/**
 * Session handler tests — /me onboarding fields and the username claim
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	updateSession: vi.fn(async () => true),
	deleteSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session_id',
	CSRF_COOKIE_NAME: 'csrf_token',
}));

import { query } from '@specboard/db';
import { getSession, updateSession } from '@specboard/auth';
import { handleGetMe, handleUpdateMe } from './session.ts';

const redis = {} as Redis;

const mockUser = {
	id: 'user-uuid-123',
	username: null,
	email: 'new@example.com',
	first_name: null,
	last_name: null,
	email_verified: true,
	phone_number: null,
	avatar_url: null,
	roles: [],
	is_active: true,
	has_password: false,
};

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.get('/api/auth/me', (c) => handleGetMe(c, redis));
	app.put('/api/auth/me', (c) => handleUpdateMe(c, redis));
	return app;
}

function request(app: Hono, method: string, body?: unknown): Promise<Response> {
	return Promise.resolve(
		app.request('http://localhost/api/auth/me', {
			method,
			headers: {
				'Content-Type': 'application/json',
				Cookie: 'session_id=abc',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		})
	);
}

describe('handleGetMe onboarding fields', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({
			userId: mockUser.id,
			csrfToken: 'x',
			createdAt: 0,
			lastAccessedAt: 0,
		});
	});

	it('reports incomplete profile and missing password', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([mockUser]) as never);
		const res = await request(createApp(), 'GET');
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.user.profile_complete).toBe(false);
		expect(data.user.has_password).toBe(false);
		expect(data.user.passkey_count).toBe(0);
	});

	it('reports complete profile once username exists', async () => {
		vi.mocked(query).mockResolvedValue(
			mockQueryResult([{ ...mockUser, username: 'alice', has_password: true }]) as never
		);
		const res = await request(createApp(), 'GET');
		const data = await res.json();
		expect(data.user.profile_complete).toBe(true);
		expect(data.user.has_password).toBe(true);
	});
});

describe('handleUpdateMe username claim', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({
			userId: mockUser.id,
			csrfToken: 'x',
			createdAt: 0,
			lastAccessedAt: 0,
			profileComplete: false,
		});
		vi.mocked(updateSession).mockResolvedValue(true);
	});

	// The claim is a single atomic UPDATE (username + names) guarded by
	// `username IS NULL`, returning the row.
	function mockClaimQueries(claimRowCount: number): void {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('SELECT is_active FROM users')) {
				return mockQueryResult([{ is_active: true }]);
			}
			if (text.includes('SET username = $1')) {
				const rows = claimRowCount > 0
					? [{ ...mockUser, username: 'alice', first_name: 'Alice', last_name: 'A' }]
					: [];
				return mockQueryResult(rows, claimRowCount);
			}
			return mockQueryResult([]);
		});
	}

	it('claims username and names in one guarded statement and flips the flag', async () => {
		mockClaimQueries(1);
		const res = await request(createApp(), 'PUT', {
			username: 'Alice',
			first_name: 'Alice',
			last_name: 'A',
		});
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.user.username).toBe('alice');
		expect(updateSession).toHaveBeenCalledWith(redis, 'abc', { profileComplete: true });

		const claimCall = vi.mocked(query).mock.calls.find((call) =>
			(call[0] as string).includes('SET username = $1')
		);
		// Guard clause and names must be in the SAME statement (atomicity)
		expect(claimCall?.[0]).toContain('username IS NULL');
		expect(claimCall?.[0]).toContain('first_name');
		expect(claimCall?.[0]).toContain('last_name');
		expect(claimCall?.[1]?.[0]).toBe('alice');
	});

	it('requires names when claiming a username, before any DB write', async () => {
		mockClaimQueries(1);
		const res = await request(createApp(), 'PUT', { username: 'alice' });
		expect(res.status).toBe(400);
		const claimCall = vi.mocked(query).mock.calls.find((call) =>
			(call[0] as string).includes('SET username = $1')
		);
		expect(claimCall).toBeUndefined();
	});

	it('rejects invalid usernames', async () => {
		const res = await request(createApp(), 'PUT', { username: 'no spaces!' });
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a non-string username with 400, not 500', async () => {
		const res = await request(createApp(), 'PUT', { username: 123 });
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a second claim once username is set, without flipping the flag', async () => {
		mockClaimQueries(0);
		const res = await request(createApp(), 'PUT', {
			username: 'alice',
			first_name: 'Alice',
			last_name: 'A',
		});
		expect(res.status).toBe(409);
		expect(updateSession).not.toHaveBeenCalled();
	});

	it('maps unique violations to a taken-username conflict', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('SELECT is_active FROM users')) {
				return mockQueryResult([{ is_active: true }]);
			}
			if (text.includes('SET username = $1')) {
				const err = new Error('duplicate key') as Error & { code: string };
				err.code = '23505';
				throw err;
			}
			return mockQueryResult([]);
		});
		const res = await request(createApp(), 'PUT', {
			username: 'alice',
			first_name: 'Alice',
			last_name: 'A',
		});
		const data = await res.json();
		expect(res.status).toBe(409);
		expect(data.error).toBe('Username already taken');
	});
});
