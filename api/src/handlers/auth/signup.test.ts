/**
 * Signup handler tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type pg from 'pg';

// Mock dependencies before imports
vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	validatePassword: vi.fn(),
	hashPassword: vi.fn(),
	generateToken: vi.fn(),
	hashToken: vi.fn(),
	getTokenExpiry: vi.fn(),
}));

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(),
	getVerificationEmailContent: vi.fn(),
}));

import { query } from '@specboard/db';
import { validatePassword, hashPassword, generateToken, hashToken, getTokenExpiry } from '@specboard/auth';
import { sendEmail, getVerificationEmailContent } from '@specboard/email';
import { handleSignup } from './signup.ts';

// Valid signup body shared across tests
const validBody = {
	username: 'testuser',
	email: 'test@example.com',
	password: 'SecurePass123!',
	first_name: 'Test',
	last_name: 'User',
	invite_key: 'valid-key',
};

// Mock user returned from INSERT
const mockUser = {
	id: 'user-uuid-123',
	username: 'testuser',
	email: 'test@example.com',
	first_name: 'Test',
	last_name: 'User',
	email_verified: false,
	email_verified_at: null,
	phone_number: null,
	avatar_url: null,
	roles: [],
	is_active: true,
	deactivated_at: null,
	signup_metadata: { invite_key: 'valid-key' },
	created_at: new Date(),
	updated_at: new Date(),
};

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.post('/api/auth/signup', handleSignup);
	return app;
}

function postSignup(app: Hono, body: unknown): Response | Promise<Response> {
	return app.request('http://localhost/api/auth/signup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/**
 * Set up mocks for a successful signup flow.
 * Individual tests can override specific mocks after calling this.
 */
function setupSuccessMocks(): void {
	process.env.INVITE_KEYS = 'valid-key,other-key';
	process.env.APP_URL = 'http://localhost:3000';

	vi.mocked(validatePassword).mockReturnValue({ valid: true, errors: [] });
	vi.mocked(hashPassword).mockResolvedValue('hashed-password');
	vi.mocked(generateToken).mockReturnValue('verify-token');
	vi.mocked(hashToken).mockReturnValue('hashed-token');
	vi.mocked(getTokenExpiry).mockReturnValue(new Date('2099-01-01'));
	vi.mocked(getVerificationEmailContent).mockReturnValue({
		subject: 'Verify',
		textBody: 'Verify your email',
		htmlBody: '<p>Verify</p>',
	});
	vi.mocked(sendEmail).mockResolvedValue(undefined);

	// Default query mock: username check, email check, insert user, insert password, insert token
	vi.mocked(query).mockImplementation(async (sql: string): Promise<pg.QueryResult> => {
		if (sql.includes('SELECT id FROM users WHERE username')) {
			return mockQueryResult([]); // username available
		}
		if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) {
			return mockQueryResult([]); // email available
		}
		if (sql.includes('INSERT INTO users')) {
			return mockQueryResult([mockUser]);
		}
		if (sql.includes('INSERT INTO user_passwords')) {
			return mockQueryResult([], 1);
		}
		if (sql.includes('INSERT INTO email_verification_tokens')) {
			return mockQueryResult([], 1);
		}
		return mockQueryResult([]);
	});
}

describe('handleSignup', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		delete process.env.INVITE_KEYS;
		delete process.env.APP_URL;
	});

	// ── Request validation ──────────────────────────────────────────

	it('returns 400 for invalid JSON', async () => {
		const app = createApp();
		const res = await app.request('http://localhost/api/auth/signup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not json',
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid JSON' });
	});

	it('returns 400 when required fields are missing', async () => {
		const app = createApp();
		const res = await postSignup(app, { username: 'test' });
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain('All fields are required');
	});

	it('returns 403 for invalid invite key', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		const app = createApp();
		const res = await postSignup(app, { ...validBody, invite_key: 'wrong-key' });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'Invalid invite key' });
	});

	it('returns 403 when no invite keys are configured', async () => {
		// INVITE_KEYS not set — all signups rejected
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(403);
	});

	it('returns 400 for invalid username', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		const app = createApp();
		const res = await postSignup(app, { ...validBody, username: 'ab' }); // too short
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain('Username');
	});

	it('returns 400 for invalid email', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		const app = createApp();
		const res = await postSignup(app, { ...validBody, email: 'not-an-email' });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain('email');
	});

	it('returns 400 for weak password', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		vi.mocked(validatePassword).mockReturnValue({ valid: false, errors: [{ code: 'too_weak', message: 'too weak' }] });
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain('complexity');
	});

	it('returns 400 for whitespace-only names', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		vi.mocked(validatePassword).mockReturnValue({ valid: true, errors: [] });
		const app = createApp();
		const res = await postSignup(app, { ...validBody, first_name: '   ' });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain('required');
	});

	it('returns 400 for names exceeding 255 characters', async () => {
		process.env.INVITE_KEYS = 'valid-key';
		vi.mocked(validatePassword).mockReturnValue({ valid: true, errors: [] });
		const app = createApp();
		const res = await postSignup(app, { ...validBody, last_name: 'A'.repeat(256) });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toContain('too long');
	});

	// ── Duplicate checks ────────────────────────────────────────────

	it('returns 409 when username is taken', async () => {
		setupSuccessMocks();
		vi.mocked(query).mockImplementation(async (sql: string): Promise<pg.QueryResult> => {
			if (sql.includes('SELECT id FROM users WHERE username')) {
				return mockQueryResult([{ id: 'existing-user' }]); // taken
			}
			return mockQueryResult([]);
		});
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain('Username already taken');
	});

	it('returns 409 when email is already registered', async () => {
		setupSuccessMocks();
		vi.mocked(query).mockImplementation(async (sql: string): Promise<pg.QueryResult> => {
			if (sql.includes('SELECT id FROM users WHERE username')) {
				return mockQueryResult([]); // username available
			}
			if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) {
				return mockQueryResult([{ id: 'existing-user' }]); // email taken
			}
			return mockQueryResult([]);
		});
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain('Email already registered');
	});

	// ── Successful signup ───────────────────────────────────────────

	it('creates account and returns 201', async () => {
		setupSuccessMocks();
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.message).toContain('check your email');
		expect(data.email).toBe('test@example.com');
	});

	it('stores username and email in lowercase', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, { ...validBody, username: 'TestUser', email: 'Test@Example.COM' });

		// Find the INSERT INTO users call
		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		expect(insertCall).toBeDefined();
		const params = insertCall![1] as unknown[];
		expect(params[0]).toBe('testuser'); // lowercase username
		expect(params[3]).toBe('test@example.com'); // lowercase email
	});

	it('trims names before storing', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, { ...validBody, first_name: '  Test  ', last_name: '  User  ' });

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		expect(params[1]).toBe('Test'); // trimmed first_name
		expect(params[2]).toBe('User'); // trimmed last_name
	});

	it('hashes password before storing', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, validBody);

		expect(hashPassword).toHaveBeenCalledWith('SecurePass123!');
		const passwordCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO user_passwords')
		);
		expect(passwordCall).toBeDefined();
		expect((passwordCall![1] as string[])[1]).toBe('hashed-password');
	});

	it('sends verification email', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, validBody);

		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
			to: 'test@example.com',
		}));
	});

	it('succeeds even if verification email fails', async () => {
		setupSuccessMocks();
		vi.mocked(sendEmail).mockRejectedValue(new Error('SES error'));
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(201); // still succeeds
	});

	// ── Signup metadata ─────────────────────────────────────────────

	it('stores invite key in signup_metadata', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, validBody);

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		const metadata = JSON.parse(String(params[4]));
		expect(metadata.invite_key).toBe('valid-key');
	});

	it('trims invite key in signup_metadata', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, { ...validBody, invite_key: '  valid-key  ' });

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		const metadata = JSON.parse(String(params[4]));
		expect(metadata.invite_key).toBe('valid-key');
	});

	it('stores UTM parameters in signup_metadata', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, {
			...validBody,
			utm_source: 'twitter',
			utm_medium: 'social',
			utm_campaign: 'launch',
		});

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		const metadata = JSON.parse(String(params[4]));
		expect(metadata.utm_source).toBe('twitter');
		expect(metadata.utm_medium).toBe('social');
		expect(metadata.utm_campaign).toBe('launch');
	});

	it('omits empty UTM fields from signup_metadata', async () => {
		setupSuccessMocks();
		const app = createApp();
		await postSignup(app, validBody); // no UTM fields

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		const metadata = JSON.parse(String(params[4]));
		expect(Object.keys(metadata)).toEqual(['invite_key']);
	});

	it('truncates UTM fields exceeding 500 characters', async () => {
		setupSuccessMocks();
		const app = createApp();
		const longValue = 'A'.repeat(600);
		await postSignup(app, { ...validBody, utm_source: longValue });

		const insertCall = vi.mocked(query).mock.calls.find(
			([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO users')
		);
		const params = insertCall![1] as unknown[];
		const metadata = JSON.parse(String(params[4]));
		expect(metadata.utm_source).toHaveLength(500);
	});

	// ── Race condition handling ──────────────────────────────────────

	it('handles unique constraint violation on username (race condition)', async () => {
		setupSuccessMocks();
		const pgError = Object.assign(new Error('unique violation'), {
			code: '23505',
			detail: 'Key (username)=(testuser) already exists.',
		});
		vi.mocked(query).mockImplementation(async (sql: string): Promise<pg.QueryResult> => {
			if (sql.includes('SELECT id FROM users WHERE username')) {
				return mockQueryResult([]); // passes initial check
			}
			if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) {
				return mockQueryResult([]);
			}
			if (sql.includes('INSERT INTO users')) {
				throw pgError; // race condition
			}
			return mockQueryResult([]);
		});
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain('Username already taken');
	});

	it('handles unique constraint violation on email (race condition)', async () => {
		setupSuccessMocks();
		const pgError = Object.assign(new Error('unique violation'), {
			code: '23505',
			detail: 'Key (email)=(test@example.com) already exists.',
		});
		vi.mocked(query).mockImplementation(async (sql: string): Promise<pg.QueryResult> => {
			if (sql.includes('SELECT id FROM users WHERE username')) {
				return mockQueryResult([]);
			}
			if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) {
				return mockQueryResult([]);
			}
			if (sql.includes('INSERT INTO users')) {
				throw pgError;
			}
			return mockQueryResult([]);
		});
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(409);
		expect((await res.json()).error).toContain('Email already registered');
	});

	it('returns 500 for unexpected database errors', async () => {
		setupSuccessMocks();
		vi.mocked(query).mockRejectedValue(new Error('connection refused'));
		const app = createApp();
		const res = await postSignup(app, validBody);
		expect(res.status).toBe(500);
	});
});
