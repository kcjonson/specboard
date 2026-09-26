/**
 * User update handler tests: which updates sign the target out everywhere
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
	deleteUserSessions: vi.fn(async () => undefined),
}));

vi.mock('./auth-utils.ts', async (importOriginal) => ({
	...await importOriginal<typeof import('./auth-utils.ts')>(),
	getCurrentUser: vi.fn(),
}));

import { query } from '@specboard/db';
import { deleteUserSessions } from '@specboard/auth';
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

describe('handleUpdateUser session invalidation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getCurrentUser).mockResolvedValue(admin);
	});

	it('leaves sessions alone for a role change', async () => {
		mockTargetAfterUpdate(user({ roles: [] }));

		const res = await put({ roles: [] });

		expect(res.status).toBe(200);
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
