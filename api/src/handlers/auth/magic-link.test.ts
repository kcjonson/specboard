/**
 * Magic link handler tests
 *
 * Token/code hashing uses real SHA-256 in the mock so hash round-trips are
 * exercised; session creation and rate limiting are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', async () => {
	const { createHash, timingSafeEqual } = await import('node:crypto');
	const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
	return {
		generateToken: vi.fn(() => 'a1'.repeat(32)),
		generateLoginCode: vi.fn(() => 'KDWQ7R2M'),
		hashToken: vi.fn(sha256),
		verifyToken: vi.fn((token: string, storedHash: string) => {
			const a = Buffer.from(sha256(token), 'hex');
			const b = Buffer.from(storedHash, 'hex');
			return a.length === b.length && timingSafeEqual(a, b);
		}),
		normalizeLoginCode: vi.fn((input: string) => {
			const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
			return /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/.test(normalized) ? normalized : null;
		}),
		isTokenExpired: vi.fn((expiresAt: Date) => new Date() > expiresAt),
		checkRateLimitKey: vi.fn(async () => true),
		generateSessionId: vi.fn(() => 'session-id'),
		createSession: vi.fn(async () => 'csrf-token'),
		MAGIC_LINK_EXPIRY_MS: 15 * 60 * 1000,
		RATE_LIMIT_CONFIGS: {
			magicLinkEmail: {
				maxRequests: 3,
				windowSeconds: 3600,
				message: 'Too many sign-in code requests for this email, please try again in an hour',
			},
		},
		SESSION_COOKIE_NAME: 'session_id',
		CSRF_COOKIE_NAME: 'csrf_token',
		SESSION_TTL_SECONDS: 3600,
	};
});

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(async () => undefined),
	getMagicLinkEmailContent: vi.fn(() => ({
		subject: 'Your sign-in code',
		textBody: 'text',
		htmlBody: '<p>html</p>',
	})),
}));

import { query } from '@specboard/db';
import { checkRateLimitKey, createSession } from '@specboard/auth';
import { sendEmail, getMagicLinkEmailContent } from '@specboard/email';
import { handleMagicLinkRequest, handleMagicLinkVerify } from './magic-link.ts';

const redis = {} as Redis;

const TOKEN = 'a1'.repeat(32);
const CODE = 'KDWQ7R2M';
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const mockUser = {
	id: 'user-uuid-123',
	username: 'alice',
	email: 'alice@example.com',
	first_name: 'Alice',
	last_name: 'A',
	avatar_url: null,
	email_verified: false,
	is_active: true,
};

function futureDate(): Date {
	return new Date(Date.now() + 10 * 60 * 1000);
}

function mockTokenRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'token-row-id',
		user_id: mockUser.id,
		token_hash: sha256(TOKEN),
		code_hash: sha256(CODE),
		code_attempts: 0,
		next_path: null,
		expires_at: futureDate(),
		...overrides,
	};
}

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.post('/api/auth/magic-link/request', (c) => handleMagicLinkRequest(c, redis));
	app.post('/api/auth/magic-link/verify', (c) => handleMagicLinkVerify(c, redis));
	return app;
}

function post(app: Hono, path: string, body: unknown): Promise<Response> {
	return Promise.resolve(
		app.request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

describe('handleMagicLinkRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkRateLimitKey).mockResolvedValue(true);
		vi.mocked(sendEmail).mockResolvedValue(undefined);
	});

	it('rejects invalid email addresses', async () => {
		const res = await post(createApp(), '/api/auth/magic-link/request', { email: 'not-an-email' });
		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('returns the generic message for unknown emails without issuing a token', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([]) as never);
		const res = await post(createApp(), '/api/auth/magic-link/request', { email: 'ghost@example.com' });
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.message).toContain('If that email has an account');
		expect(sendEmail).not.toHaveBeenCalled();
		const sqls = vi.mocked(query).mock.calls.map((call) => call[0] as string);
		expect(sqls.some((sql) => sql.includes('INSERT INTO magic_link_tokens'))).toBe(false);
	});

	it('issues a token and sends the email for known active users, with the same response', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT * FROM users WHERE LOWER(email)')) {
				return mockQueryResult([mockUser]);
			}
			return mockQueryResult([], 1);
		});

		const res = await post(createApp(), '/api/auth/magic-link/request', {
			email: 'alice@example.com',
			next: '/projects/abc',
		});
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.message).toContain('If that email has an account');

		const calls = vi.mocked(query).mock.calls;
		// Atomic upsert (one row per user), not DELETE-then-INSERT
		const insertCall = calls.find((call) => (call[0] as string).includes('INSERT INTO magic_link_tokens'));
		expect(insertCall).toBeDefined();
		expect(insertCall?.[0]).toContain('ON CONFLICT (user_id)');
		expect(calls.some((call) => (call[0] as string).includes('DELETE FROM magic_link_tokens'))).toBe(false);
		// Stored values are hashes, never the raw token or code
		expect(insertCall?.[1]).toContain(sha256(TOKEN));
		expect(insertCall?.[1]).toContain(sha256(CODE));
		expect(insertCall?.[1]).toContain('/projects/abc');

		expect(getMagicLinkEmailContent).toHaveBeenCalledWith(
			expect.stringContaining(`/magic-link?token=${TOKEN}`),
			'KDWQ-7R2M'
		);
		expect(sendEmail).toHaveBeenCalledOnce();
	});

	it('drops unsafe next paths', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT * FROM users WHERE LOWER(email)')) {
				return mockQueryResult([mockUser]);
			}
			return mockQueryResult([], 1);
		});

		await post(createApp(), '/api/auth/magic-link/request', {
			email: 'alice@example.com',
			next: '//evil.example.com/phish',
		});

		const insertCall = vi.mocked(query).mock.calls.find((call) =>
			(call[0] as string).includes('INSERT INTO magic_link_tokens')
		);
		expect(insertCall?.[1]).toContain(null);
		expect(insertCall?.[1]).not.toContain('//evil.example.com/phish');
	});

	it('does not issue tokens for deactivated users', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([{ ...mockUser, is_active: false }]) as never);
		const res = await post(createApp(), '/api/auth/magic-link/request', { email: 'alice@example.com' });
		expect(res.status).toBe(200);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('returns 429 when the per-email bucket is exhausted, before the account lookup', async () => {
		vi.mocked(checkRateLimitKey).mockResolvedValue(false);
		const res = await post(createApp(), '/api/auth/magic-link/request', { email: 'alice@example.com' });
		expect(res.status).toBe(429);
		expect(query).not.toHaveBeenCalled();
	});
});

describe('handleMagicLinkVerify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createSession).mockResolvedValue('csrf-token');
	});

	function mockVerifyQueries(row: Record<string, unknown>, user = mockUser): void {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('WHERE token_hash')) {
				return mockQueryResult([row]);
			}
			if (text.includes('JOIN users u ON u.id = t.user_id')) {
				return mockQueryResult([row]);
			}
			if (text.includes('SET code_attempts = code_attempts + 1')) {
				const attempts = ((row.code_attempts as number) ?? 0) + 1;
				row.code_attempts = attempts;
				return mockQueryResult([{ code_attempts: attempts }]);
			}
			if (text.includes('RETURNING id')) {
				return mockQueryResult([{ id: row.id }]);
			}
			if (text.includes('SELECT * FROM users WHERE id')) {
				return mockQueryResult([user]);
			}
			if (text.includes('SET email_verified = true')) {
				return mockQueryResult([], user.email_verified ? 0 : 1);
			}
			return mockQueryResult([]);
		});
	}

	it('requires a token or an email and code', async () => {
		const res = await post(createApp(), '/api/auth/magic-link/verify', {});
		expect(res.status).toBe(400);
	});

	it('logs in with a valid link token and sets session cookies', async () => {
		mockVerifyQueries(mockTokenRow({ next_path: '/projects/abc' }));
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: TOKEN });
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.user.id).toBe(mockUser.id);
		expect(data.next).toBe('/projects/abc');
		expect(res.headers.get('set-cookie')).toContain('session_id=');
		expect(createSession).toHaveBeenCalledWith(redis, 'session-id', {
			userId: mockUser.id,
			authMethod: 'magic_link',
			profileComplete: true,
		});

		// Lookup must be by the token HASH, not the raw token
		const lookupCall = vi.mocked(query).mock.calls.find((call) => (call[0] as string).includes('WHERE token_hash'));
		expect(lookupCall?.[1]).toEqual([sha256(TOKEN)]);

		const sqls = vi.mocked(query).mock.calls.map((call) => call[0] as string);
		expect(sqls.some((sql) => sql.includes('RETURNING id'))).toBe(true);
		expect(sqls.some((sql) => sql.includes('SET email_verified = true'))).toBe(true);
	});

	it('rejects a cross-origin verify (login-CSRF guard)', async () => {
		mockVerifyQueries(mockTokenRow());
		const res = await Promise.resolve(
			createApp().request('http://localhost/api/auth/magic-link/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'https://evil.example.com' },
				body: JSON.stringify({ token: TOKEN }),
			})
		);
		expect(res.status).toBe(403);
		expect(createSession).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});

	it('accepts a same-origin verify', async () => {
		mockVerifyQueries(mockTokenRow());
		const res = await Promise.resolve(
			createApp().request('http://localhost/api/auth/magic-link/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost' },
				body: JSON.stringify({ token: TOKEN }),
			})
		);
		expect(res.status).toBe(200);
	});

	it('accepts a same-origin verify behind a proxy that preserves Host', async () => {
		mockVerifyQueries(mockTokenRow());
		// Our proxies (nginx, ALB) forward the client Host unchanged, so a
		// legitimate request carries Host === the real serving host.
		const res = await Promise.resolve(
			createApp().request('http://localhost/api/auth/magic-link/verify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Host: 'specboard.io',
					Origin: 'https://specboard.io',
				},
				body: JSON.stringify({ token: TOKEN }),
			})
		);
		expect(res.status).toBe(200);
	});

	it('accepts a same-origin IPv6 host', async () => {
		mockVerifyQueries(mockTokenRow());
		const res = await Promise.resolve(
			createApp().request('http://localhost/api/auth/magic-link/verify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Host: '[::1]:3001',
					Origin: 'http://[::1]:3001',
				},
				body: JSON.stringify({ token: TOKEN }),
			})
		);
		expect(res.status).toBe(200);
	});

	it('ignores X-Forwarded-Host so it cannot be used to whitelist a foreign Origin', async () => {
		mockVerifyQueries(mockTokenRow());
		// Neither nginx nor the ALB sets X-Forwarded-Host, so any value present is
		// attacker-supplied. Setting it to match a foreign Origin must NOT pass:
		// the guard compares Origin against the real Host only.
		const res = await Promise.resolve(
			createApp().request('http://localhost/api/auth/magic-link/verify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Host: 'specboard.io',
					'X-Forwarded-Host': 'evil.example.com',
					Origin: 'https://evil.example.com',
				},
				body: JSON.stringify({ token: TOKEN }),
			})
		);
		expect(res.status).toBe(403);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('accepts the correct code on the 5th (final) attempt', async () => {
		// code_attempts already 4; this attempt increments to 5 (== cap), so
		// the correct code must still succeed (guards against > vs >=)
		mockVerifyQueries(mockTokenRow({ code_attempts: 4 }));
		const res = await post(createApp(), '/api/auth/magic-link/verify', {
			email: 'alice@example.com',
			code: CODE,
		});
		expect(res.status).toBe(200);
		expect(createSession).toHaveBeenCalledOnce();
	});

	it('rejects malformed tokens without querying', async () => {
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: 'short' });
		expect(res.status).toBe(401);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects unknown tokens with the generic message', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([]) as never);
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: 'b2'.repeat(32) });
		const data = await res.json();
		expect(res.status).toBe(401);
		expect(data.error).toBe('That code or link is invalid or has expired.');
	});

	it('rejects and deletes expired tokens', async () => {
		mockVerifyQueries(mockTokenRow({ expires_at: new Date(Date.now() - 1000) }));
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: TOKEN });
		expect(res.status).toBe(401);
		const deleteCalls = vi.mocked(query).mock.calls.filter((call) =>
			(call[0] as string).includes('DELETE FROM magic_link_tokens WHERE id')
		);
		expect(deleteCalls.length).toBe(1);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('fails when the consume race is lost', async () => {
		const row = mockTokenRow();
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('WHERE token_hash')) {
				return mockQueryResult([row]);
			}
			if (text.includes('RETURNING id')) {
				return mockQueryResult([]);
			}
			return mockQueryResult([]);
		});
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: TOKEN });
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('logs in with a typed code, tolerating dashes and lowercase', async () => {
		mockVerifyQueries(mockTokenRow());
		const res = await post(createApp(), '/api/auth/magic-link/verify', {
			email: 'alice@example.com',
			code: 'kdwq-7r2m',
		});
		expect(res.status).toBe(200);
		expect(createSession).toHaveBeenCalledOnce();
	});

	it('rejects a wrong code but counts the attempt', async () => {
		mockVerifyQueries(mockTokenRow());
		const res = await post(createApp(), '/api/auth/magic-link/verify', {
			email: 'alice@example.com',
			code: 'WWWWGGGG',
		});
		expect(res.status).toBe(401);
		const attemptCalls = vi.mocked(query).mock.calls.filter((call) =>
			(call[0] as string).includes('SET code_attempts = code_attempts + 1')
		);
		expect(attemptCalls.length).toBe(1);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('deletes the row once code attempts are exhausted, even for the right code', async () => {
		mockVerifyQueries(mockTokenRow({ code_attempts: 5 }));
		const res = await post(createApp(), '/api/auth/magic-link/verify', {
			email: 'alice@example.com',
			code: CODE,
		});
		expect(res.status).toBe(401);
		const deleteCalls = vi.mocked(query).mock.calls.filter((call) =>
			(call[0] as string).includes('DELETE FROM magic_link_tokens WHERE id')
		);
		expect(deleteCalls.length).toBe(1);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('rejects codes for emails with no pending token', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([]) as never);
		const res = await post(createApp(), '/api/auth/magic-link/verify', {
			email: 'ghost@example.com',
			code: CODE,
		});
		const data = await res.json();
		expect(res.status).toBe(401);
		expect(data.error).toBe('That code or link is invalid or has expired.');
	});

	it('rejects deactivated users after consuming the token', async () => {
		mockVerifyQueries(mockTokenRow(), { ...mockUser, is_active: false });
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: TOKEN });
		expect(res.status).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('does not rewrite email_verified for already-verified users', async () => {
		mockVerifyQueries(mockTokenRow(), { ...mockUser, email_verified: true });
		const res = await post(createApp(), '/api/auth/magic-link/verify', { token: TOKEN });
		expect(res.status).toBe(200);
	});
});
