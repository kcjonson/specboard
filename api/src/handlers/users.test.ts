/**
 * User update handler tests
 *
 * Focus is keeping live sessions in step with role changes: the frontend's
 * /admin gate reads the session's isAdmin flag, not the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { User } from '@specboard/db';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	hashPassword: vi.fn(async () => 'hashed'),
	validatePassword: vi.fn(() => ({ valid: true, errors: [] })),
	updateUserSessions: vi.fn(async () => undefined),
	deleteUserSessions: vi.fn(async () => undefined),
}));

vi.mock('./auth-utils.ts', async (importOriginal) => ({
	...await importOriginal<typeof import('./auth-utils.ts')>(),
	getCurrentUser: vi.fn(),
}));

import { query } from '@specboard/db';
import { updateUserSessions, deleteUserSessions } from '@specboard/auth';
import { getCurrentUser } from './auth-utils.ts';
import { handleUpdateUser } from './users.ts';

const redis = {} as Redis;
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

function user(overrides: Partial<User>): User {
	return {
		id: TARGET_ID,
		username: 'bob',
		email: 'bob@example.com',
		first_name: 'Bob',
		last_name: 'B',
		email_verified: true,
		roles: [],
		is_active: true,
		created_at: new Date(),
		updated_at: new Date(),
		deactivated_at: null,
		...overrides,
	} as User;
}

const admin = user({ id: '22222222-2222-4222-8222-222222222222', username: 'alice', roles: ['admin'] });

function mockTargetAfterUpdate(target: User): void {
	vi.mocked(query).mockImplementation((async (sql: string) => {
		if (sql.startsWith('SELECT username FROM users')) {
			return { rows: [{ username: target.username }] };
		}
		return { rows: [target] };
	}) as never);
}

function put(body: unknown): Promise<Response> {
	const app = new Hono();
	app.put('/api/users/:id', (c) => handleUpdateUser(c, redis));
	return Promise.resolve(
		app.request(`/api/users/${TARGET_ID}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

describe('handleUpdateUser session sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
	});

	it('flags the target\'s live sessions as admin when the role is granted', async () => {
		mockTargetAfterUpdate(user({ roles: ['admin'] }));

		const res = await put({ roles: ['admin'] });

		expect(res.status).toBe(200);
		expect(updateUserSessions).toHaveBeenCalledWith(redis, TARGET_ID, { isAdmin: true });
	});

	it('clears the flag on the target\'s live sessions when the role is revoked', async () => {
		mockTargetAfterUpdate(user({ roles: [] }));

		const res = await put({ roles: [] });

		expect(res.status).toBe(200);
		expect(updateUserSessions).toHaveBeenCalledWith(redis, TARGET_ID, { isAdmin: false });
	});

	it('leaves sessions alone when roles are not part of the update', async () => {
		mockTargetAfterUpdate(user({ first_name: 'Robert' }));

		const res = await put({ first_name: 'Robert' });

		expect(res.status).toBe(200);
		expect(updateUserSessions).not.toHaveBeenCalled();
		expect(deleteUserSessions).not.toHaveBeenCalled();
	});

	it('signs the target out everywhere when the superadmin sets their password', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue({ ...admin, username: 'superadmin' });
		mockTargetAfterUpdate(user({}));

		const res = await put({ password: 'a-long-enough-password-1' });

		expect(res.status).toBe(200);
		expect(deleteUserSessions).toHaveBeenCalledWith(redis, TARGET_ID);
	});
});
