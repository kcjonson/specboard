/**
 * Signup handler tests (email-only signup)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', async () => {
	const { createHash } = await import('node:crypto');
	const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
	return {
		generateToken: vi.fn(() => 'a1'.repeat(32)),
		generateLoginCode: vi.fn(() => 'KDWQ7R2M'),
		hashToken: vi.fn(sha256),
		verifyToken: vi.fn(() => false),
		normalizeLoginCode: vi.fn(() => null),
		isTokenExpired: vi.fn(() => false),
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
import { checkRateLimitKey } from '@specboard/auth';
import { sendEmail } from '@specboard/email';
import { handleSignup } from './signup.ts';

const redis = {} as Redis;

const validBody = {
	email: 'new@example.com',
	invite_key: 'valid-key',
};

const mockNewUser = {
	id: 'user-uuid-123',
	username: null,
	email: 'new@example.com',
	first_name: null,
	last_name: null,
	email_verified: false,
	is_active: true,
	signup_metadata: { invite_key: 'valid-key' },
};

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.post('/api/auth/signup', (c) => handleSignup(c, redis));
	return app;
}

function postSignup(app: Hono, body: unknown): Promise<Response> {
	return Promise.resolve(
		app.request('http://localhost/api/auth/signup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

/** Route queries for the create-new-user path */
function mockNewUserQueries(): void {
	vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
		const text = sql as string;
		if (text.includes('SELECT * FROM users WHERE LOWER(email)')) {
			return mockQueryResult([]);
		}
		if (text.includes('INSERT INTO users')) {
			return mockQueryResult([mockNewUser]);
		}
		return mockQueryResult([], 1);
	});
}

describe('handleSignup (email-only)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.INVITE_KEYS = 'valid-key,other-key';
		vi.mocked(checkRateLimitKey).mockResolvedValue(true);
	});

	it('requires email and invite key', async () => {
		const res = await postSignup(createApp(), { email: 'new@example.com' });
		expect(res.status).toBe(400);
	});

	it('rejects invalid invite keys', async () => {
		const res = await postSignup(createApp(), { ...validBody, invite_key: 'wrong' });
		expect(res.status).toBe(403);
	});

	it('rejects invalid email formats', async () => {
		const res = await postSignup(createApp(), { ...validBody, email: 'not-an-email' });
		expect(res.status).toBe(400);
	});

	it('returns 429 when the per-email bucket is exhausted', async () => {
		vi.mocked(checkRateLimitKey).mockResolvedValue(false);
		const res = await postSignup(createApp(), validBody);
		expect(res.status).toBe(429);
		expect(query).not.toHaveBeenCalled();
	});

	it('creates a passwordless user and issues a magic link', async () => {
		mockNewUserQueries();
		const res = await postSignup(createApp(), validBody);
		const data = await res.json();

		expect(res.status).toBe(201);
		expect(data.message).toBe('Check your email for a sign-in code.');

		const sqls = vi.mocked(query).mock.calls.map((call) => call[0] as string);
		const userInsert = sqls.find((sql) => sql.includes('INSERT INTO users'));
		expect(userInsert).toBeDefined();
		expect(userInsert).not.toContain('username');
		expect(sqls.some((sql) => sql.includes('INSERT INTO user_passwords'))).toBe(false);
		expect(sqls.some((sql) => sql.includes('INSERT INTO email_verification_tokens'))).toBe(false);
		expect(sqls.some((sql) => sql.includes('INSERT INTO magic_link_tokens'))).toBe(true);
		expect(sendEmail).toHaveBeenCalledOnce();
	});

	it('passes sanitized UTM metadata into the user insert', async () => {
		mockNewUserQueries();
		await postSignup(createApp(), {
			...validBody,
			utm_source: 'newsletter',
			referral_source: 'friend',
			utm_medium: 'x'.repeat(600),
		});

		const insertCall = vi.mocked(query).mock.calls.find((call) =>
			(call[0] as string).includes('INSERT INTO users')
		);
		const metadataJson = String(insertCall?.[1]?.[1]);
		const metadata = JSON.parse(metadataJson);
		expect(metadata.utm_source).toBe('newsletter');
		expect(metadata.referral_source).toBe('friend');
		expect(metadata.utm_medium.length).toBe(500);
	});

	it('sends a login link for existing active emails with the identical response', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('SELECT * FROM users WHERE LOWER(email)')) {
				return mockQueryResult([{ ...mockNewUser, username: 'existing', email_verified: true }]);
			}
			return mockQueryResult([], 1);
		});

		const res = await postSignup(createApp(), { ...validBody, email: 'new@example.com' });
		const data = await res.json();

		expect(res.status).toBe(201);
		expect(data.message).toBe('Check your email for a sign-in code.');

		const sqls = vi.mocked(query).mock.calls.map((call) => call[0] as string);
		expect(sqls.some((sql) => sql.includes('INSERT INTO users'))).toBe(false);
		expect(sqls.some((sql) => sql.includes('INSERT INTO magic_link_tokens'))).toBe(true);
		expect(sendEmail).toHaveBeenCalledOnce();
	});

	it('does not email deactivated accounts, with the identical response', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			if ((sql as string).includes('SELECT * FROM users WHERE LOWER(email)')) {
				return mockQueryResult([{ ...mockNewUser, is_active: false }]);
			}
			return mockQueryResult([], 1);
		});

		const res = await postSignup(createApp(), validBody);
		const data = await res.json();
		expect(res.status).toBe(201);
		expect(data.message).toBe('Check your email for a sign-in code.');
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('treats a unique-violation race as the existing-email case', async () => {
		vi.mocked(query).mockImplementation(async (sql): Promise<pg.QueryResult> => {
			const text = sql as string;
			if (text.includes('SELECT * FROM users WHERE LOWER(email)')) {
				return mockQueryResult([]);
			}
			if (text.includes('INSERT INTO users')) {
				const err = new Error('duplicate key') as Error & { code: string };
				err.code = '23505';
				throw err;
			}
			return mockQueryResult([], 1);
		});

		const res = await postSignup(createApp(), validBody);
		const data = await res.json();
		expect(res.status).toBe(201);
		expect(data.message).toBe('Check your email for a sign-in code.');
	});

	it('returns 500 for unexpected database errors', async () => {
		vi.mocked(query).mockRejectedValue(new Error('connection refused'));
		const res = await postSignup(createApp(), validBody);
		expect(res.status).toBe(500);
	});
});
