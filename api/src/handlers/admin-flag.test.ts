/**
 * Session isAdmin flag vs. concurrent logins and role changes
 *
 * A login reads the user, then writes its session; a role change commits the
 * UPDATE, then scans sessions (a revoke also clears them before the UPDATE).
 * These tests run the two against one in-memory users row and session store
 * in each order that matters and check the session ends up agreeing with the
 * committed roles, and that Redis failures never leave a session more
 * privileged than the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { User } from '@specboard/db';

const db = vi.hoisted(() => ({ roles: [] as string[] }));
const sessions = vi.hoisted(() => new Map<string, { userId: string; isAdmin?: boolean }>());
const hooks = vi.hoisted(() => ({
	afterCreateSession: null as null | (() => Promise<void>),
	afterUpdateUserSessions: null as null | (() => Promise<void>),
}));

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	generateSessionId: vi.fn(() => 'login-session'),
	createSession: vi.fn(async (_redis: Redis, id: string, data: { userId: string; isAdmin?: boolean }) => {
		sessions.set(id, { userId: data.userId, isAdmin: data.isAdmin });
		await hooks.afterCreateSession?.();
		return 'csrf-token';
	}),
	updateSession: vi.fn(async (_redis: Redis, id: string, updates: { isAdmin?: boolean }) => {
		const existing = sessions.get(id);
		if (!existing) return false;
		sessions.set(id, { ...existing, ...updates });
		return true;
	}),
	updateUserSessions: vi.fn(async (_redis: Redis, userId: string, updates: { isAdmin?: boolean }) => {
		for (const [id, existing] of sessions) {
			if (existing.userId === userId) sessions.set(id, { ...existing, ...updates });
		}
		await hooks.afterUpdateUserSessions?.();
	}),
	deleteUserSessions: vi.fn(),
	hashPassword: vi.fn(),
	validatePassword: vi.fn(),
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session_id',
	CSRF_COOKIE_NAME: 'csrf_token',
	SESSION_TTL_SECONDS: 3600,
}));

vi.mock('./auth-utils.ts', async (importOriginal) => ({
	...await importOriginal<typeof import('./auth-utils.ts')>(),
	getCurrentUser: vi.fn(),
}));

import { query } from '@specboard/db';
import { updateSession, updateUserSessions } from '@specboard/auth';
import { getCurrentUser, settleAdminFlag } from './auth-utils.ts';
import { establishSession } from './auth/utils.ts';
import { handleUpdateUser } from './users.ts';

const redis = {} as Redis;
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

function target(roles: string[]): User {
	return {
		id: TARGET_ID,
		username: 'bob',
		email: 'bob@example.com',
		first_name: 'Bob',
		last_name: 'B',
		email_verified: true,
		roles,
		is_active: true,
		created_at: new Date(),
		updated_at: new Date(),
		deactivated_at: null,
	} as User;
}

const admin = { ...target(['admin']), id: '22222222-2222-4222-8222-222222222222', username: 'alice' } as User;

// The users row as the database holds it: UPDATE commits new roles, SELECTs read them
function mockUsersTable(): void {
	vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
		if (sql.startsWith('SELECT username FROM users')) return { rows: [{ username: 'bob' }] };
		if (sql.startsWith('UPDATE users SET roles')) db.roles = params[0] as string[];
		return { rows: [target(db.roles)] };
	}) as never);
}

function login(user: User): Promise<Response> {
	const app = new Hono();
	app.post('/login', async (c) => {
		await establishSession(c, redis, user, 'password');
		return c.json({ ok: true });
	});
	return Promise.resolve(app.request('/login', { method: 'POST' }));
}

function setRoles(roles: string[]): Promise<Response> {
	const app = new Hono();
	app.put('/api/users/:id', (c) => handleUpdateUser(c, redis));
	return Promise.resolve(
		app.request(`/api/users/${TARGET_ID}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ roles }),
		})
	);
}

describe('session admin flag under concurrent login and role change', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessions.clear();
		hooks.afterCreateSession = null;
		hooks.afterUpdateUserSessions = null;
		db.roles = ['admin'];
		mockUsersTable();
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
	});

	it('login recheck catches a revoke whose scan ran before the session existed', async () => {
		const readBeforeRevoke = target(['admin']);

		expect((await setRoles([])).status).toBe(200);
		expect((await login(readBeforeRevoke)).status).toBe(200);

		expect(sessions.get('login-session')?.isAdmin).toBe(false);
		expect(updateSession).toHaveBeenCalledWith(redis, 'login-session', { isAdmin: false });
	});

	it('role change scan catches a login whose recheck read the old roles', async () => {
		expect((await login(target(['admin']))).status).toBe(200);
		expect(sessions.get('login-session')?.isAdmin).toBe(true);
		expect(updateSession).not.toHaveBeenCalled();

		expect((await setRoles([])).status).toBe(200);

		expect(sessions.get('login-session')?.isAdmin).toBe(false);
	});

	it('converges when the revoke lands between the session write and the recheck', async () => {
		hooks.afterCreateSession = async () => {
			hooks.afterCreateSession = null;
			expect((await setRoles([])).status).toBe(200);
		};

		expect((await login(target(['admin']))).status).toBe(200);

		expect(sessions.get('login-session')?.isAdmin).toBe(false);
	});

	it('role change scan catches a login between the early revoke and the commit', async () => {
		hooks.afterUpdateUserSessions = async () => {
			hooks.afterUpdateUserSessions = null;
			expect((await login(target(['admin']))).status).toBe(200);
			expect(sessions.get('login-session')?.isAdmin).toBe(true);
		};

		expect((await setRoles([])).status).toBe(200);

		expect(sessions.get('login-session')?.isAdmin).toBe(false);
	});

	it('grants the flag to a login that read the user before the grant', async () => {
		db.roles = [];

		expect((await setRoles(['admin'])).status).toBe(200);
		expect((await login(target([]))).status).toBe(200);

		expect(sessions.get('login-session')?.isAdmin).toBe(true);
	});
});

describe('settleAdminFlag', () => {
	beforeEach(() => {
		vi.mocked(query).mockReset();
	});

	function rolesReads(...reads: string[][]): void {
		for (const roles of reads) {
			vi.mocked(query).mockResolvedValueOnce({ rows: [{ roles }] } as never);
		}
	}

	it('stops without writing when the roles still agree', async () => {
		rolesReads(['admin']);
		const write = vi.fn(async () => undefined);

		await settleAdminFlag(TARGET_ID, true, write);

		expect(write).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledWith('SELECT roles FROM users WHERE id = $1', [TARGET_ID]);
	});

	it('rewrites until a read matches the last write', async () => {
		// Revoked before the first read, granted again before the second
		rolesReads([], ['admin'], ['admin']);
		const write = vi.fn(async () => undefined);

		await settleAdminFlag(TARGET_ID, true, write);

		expect(write.mock.calls).toEqual([[false], [true]]);
	});

	it('treats a deleted user as not admin', async () => {
		vi.mocked(query).mockResolvedValue({ rows: [] } as never);
		const write = vi.fn(async () => undefined);

		await settleAdminFlag(TARGET_ID, true, write);

		expect(write.mock.calls).toEqual([[false]]);
	});
});

describe('handleUpdateUser flag write order', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessions.clear();
		hooks.afterCreateSession = null;
		hooks.afterUpdateUserSessions = null;
		mockUsersTable();
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
	});

	function roleUpdateOrder(): number {
		const index = vi.mocked(query).mock.calls.findIndex(([sql]) => (sql as string).startsWith('UPDATE users'));
		expect(index).toBeGreaterThanOrEqual(0);
		return vi.mocked(query).mock.invocationCallOrder[index]!;
	}

	it('clears sessions before committing a revoke, and again after', async () => {
		db.roles = ['admin'];

		expect((await setRoles([])).status).toBe(200);

		const [before, after] = vi.mocked(updateUserSessions).mock.invocationCallOrder;
		expect(vi.mocked(updateUserSessions).mock.calls.slice(0, 2)).toEqual([
			[redis, TARGET_ID, { isAdmin: false }],
			[redis, TARGET_ID, { isAdmin: false }],
		]);
		expect(before).toBeLessThan(roleUpdateOrder());
		expect(after).toBeGreaterThan(roleUpdateOrder());
	});

	it('leaves the role in place when clearing sessions fails before a revoke', async () => {
		db.roles = ['admin'];
		sessions.set('existing', { userId: TARGET_ID, isAdmin: true });
		vi.mocked(updateUserSessions).mockRejectedValueOnce(new Error('redis down'));

		expect((await setRoles([])).status).toBe(500);

		expect(db.roles).toEqual(['admin']);
		expect(vi.mocked(query).mock.calls.some(([sql]) => (sql as string).startsWith('UPDATE users'))).toBe(false);
	});

	it('commits a grant before writing it to sessions', async () => {
		db.roles = [];

		expect((await setRoles(['admin'])).status).toBe(200);

		expect(vi.mocked(updateUserSessions).mock.calls[0]).toEqual([redis, TARGET_ID, { isAdmin: true }]);
		expect(vi.mocked(updateUserSessions).mock.invocationCallOrder[0]).toBeGreaterThan(roleUpdateOrder());
	});

	it('leaves sessions non-admin when writing a grant fails', async () => {
		db.roles = [];
		sessions.set('existing', { userId: TARGET_ID, isAdmin: false });
		vi.mocked(updateUserSessions).mockRejectedValueOnce(new Error('redis down'));

		expect((await setRoles(['admin'])).status).toBe(500);

		expect(db.roles).toEqual(['admin']);
		expect(sessions.get('existing')?.isAdmin).toBe(false);
	});
});
