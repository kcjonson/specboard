/**
 * Login handler tests — failure limit wiring
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

// Mock dependencies before imports
vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	generateSessionId: vi.fn(() => 'session-id'),
	createSession: vi.fn(async () => 'csrf-token'),
	verifyPassword: vi.fn(),
	failureLimitKey: vi.fn(() => 'authfail:alice|10.0.0.1'),
	isFailureLimited: vi.fn(),
	recordFailure: vi.fn(),
	clearFailures: vi.fn(),
	LOGIN_FAILURE_LIMIT: {
		maxFailures: 5,
		windowSeconds: 900,
		message: 'Too many failed login attempts, please try again in 15 minutes',
	},
	SESSION_COOKIE_NAME: 'session',
	CSRF_COOKIE_NAME: 'csrf',
	SESSION_TTL_SECONDS: 3600,
}));

import { query } from '@specboard/db';
import { verifyPassword, isFailureLimited, recordFailure, clearFailures } from '@specboard/auth';
import { handleLogin } from './login.ts';

const redis = {} as Redis;

const mockUser = {
	id: 'user-uuid-123',
	username: 'alice',
	email: 'alice@example.com',
	first_name: 'Alice',
	last_name: 'A',
	avatar_url: null,
	email_verified: true,
	is_active: true,
	password_hash: 'hashed',
};

function login(): Promise<Response> {
	const app = new Hono();
	app.post('/api/auth/login', (c) => handleLogin(c, redis));
	return app.request('/api/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identifier: 'alice', password: 'pw' }),
	});
}

describe('handleLogin failure limiting', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isFailureLimited).mockResolvedValue(false);
	});

	it('returns 429 without touching the database when limited', async () => {
		vi.mocked(isFailureLimited).mockResolvedValue(true);
		const res = await login();
		expect(res.status).toBe(429);
		expect(query).not.toHaveBeenCalled();
		expect(recordFailure).not.toHaveBeenCalled();
	});

	it('records a failure on invalid credentials', async () => {
		vi.mocked(query).mockResolvedValue({ rows: [mockUser] } as never);
		vi.mocked(verifyPassword).mockResolvedValue(false);
		const res = await login();
		expect(res.status).toBe(401);
		expect(recordFailure).toHaveBeenCalledOnce();
		expect(clearFailures).not.toHaveBeenCalled();
	});

	it('records a failure for unknown users', async () => {
		vi.mocked(query).mockResolvedValue({ rows: [] } as never);
		vi.mocked(verifyPassword).mockResolvedValue(false);
		const res = await login();
		expect(res.status).toBe(401);
		expect(recordFailure).toHaveBeenCalledOnce();
	});

	it('clears failures on successful login', async () => {
		vi.mocked(query).mockResolvedValue({ rows: [mockUser] } as never);
		vi.mocked(verifyPassword).mockResolvedValue(true);
		const res = await login();
		expect(res.status).toBe(200);
		expect(clearFailures).toHaveBeenCalledOnce();
		expect(recordFailure).not.toHaveBeenCalled();
	});

	it('does not count a correct password on an unverified account as a failure', async () => {
		vi.mocked(query).mockResolvedValue({
			rows: [{ ...mockUser, email_verified: false }],
		} as never);
		vi.mocked(verifyPassword).mockResolvedValue(true);
		const res = await login();
		expect(res.status).toBe(403);
		expect(recordFailure).not.toHaveBeenCalled();
		expect(clearFailures).not.toHaveBeenCalled();
	});
});
