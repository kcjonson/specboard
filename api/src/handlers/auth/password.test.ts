/**
 * Password handler tests — first-password set for passwordless accounts
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
	validatePassword: vi.fn(() => ({ valid: true, errors: [] })),
	hashPassword: vi.fn(async () => 'hashed-new'),
	verifyPassword: vi.fn(),
	generateToken: vi.fn(),
	hashToken: vi.fn(),
	getTokenExpiry: vi.fn(),
	isTokenExpired: vi.fn(),
	SESSION_COOKIE_NAME: 'session_id',
	deleteUserSessions: vi.fn(async () => undefined),
}));

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(),
	getPasswordResetEmailContent: vi.fn(),
}));

import { query } from '@specboard/db';
import { getSession, verifyPassword, isTokenExpired, deleteUserSessions } from '@specboard/auth';
import { handleChangePassword, handleResetPassword } from './password.ts';

const redis = {} as Redis;

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.put('/api/auth/change-password', (c) => handleChangePassword(c, redis));
	return app;
}

function changePassword(app: Hono, body: unknown): Promise<Response> {
	return Promise.resolve(
		app.request('http://localhost/api/auth/change-password', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Cookie: 'session_id=abc',
			},
			body: JSON.stringify(body),
		})
	);
}

describe('handleChangePassword', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSession).mockResolvedValue({
			userId: 'user-uuid-123',
			csrfToken: 'x',
			createdAt: 0,
		});
	});

	it('sets a first password without current_password when none exists', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT password_hash')) {
				return mockQueryResult([]);
			}
			return mockQueryResult([], 1);
		});

		const res = await changePassword(createApp(), { new_password: 'NewSecure123!' });
		expect(res.status).toBe(200);
		expect(verifyPassword).not.toHaveBeenCalled();
		const upsert = vi.mocked(query).mock.calls.find((call) =>
			(call[0] as string).includes('INSERT INTO user_passwords')
		);
		expect(upsert?.[0]).toContain('ON CONFLICT');
	});

	it('still requires current_password when one exists', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([{ password_hash: 'old' }]) as never);
		const res = await changePassword(createApp(), { new_password: 'NewSecure123!' });
		expect(res.status).toBe(400);
	});

	it('rejects a wrong current password', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([{ password_hash: 'old' }]) as never);
		vi.mocked(verifyPassword).mockResolvedValue(false);
		const res = await changePassword(createApp(), {
			current_password: 'wrong',
			new_password: 'NewSecure123!',
		});
		expect(res.status).toBe(401);
	});

	it('changes the password with a valid current password', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT password_hash')) {
				return mockQueryResult([{ password_hash: 'old' }]);
			}
			return mockQueryResult([], 1);
		});
		vi.mocked(verifyPassword).mockResolvedValue(true);
		const res = await changePassword(createApp(), {
			current_password: 'OldSecure123!',
			new_password: 'NewSecure123!',
		});
		expect(res.status).toBe(200);
	});
});

describe('handleResetPassword', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('signs the user out on every device after resetting the password', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('FROM password_reset_tokens')) {
				return mockQueryResult([{ id: 'token-1', user_id: 'user-1', token_hash: 'h', expires_at: new Date() }]);
			}
			return mockQueryResult([], 1);
		});
		vi.mocked(isTokenExpired).mockReturnValue(false);
		const app = new Hono();
		app.post('/api/auth/reset-password', (c) => handleResetPassword(c, redis));

		const res = await app.request('http://localhost/api/auth/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: 'a'.repeat(64), password: 'NewSecure123!' }),
		});

		expect(res.status).toBe(200);
		expect(deleteUserSessions).toHaveBeenCalledWith(redis, 'user-1');
	});
});
