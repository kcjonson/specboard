/**
 * User handler tests: the user slug, both self-service edits through PUT /api/users/:id
 * and the default slug admin user create derives, suffixed past collisions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/auth', () => ({
	hashPassword: vi.fn(async () => 'hash'),
	validatePassword: vi.fn(() => ({ valid: true })),
}));

vi.mock('./auth-utils.ts', () => ({
	getCurrentUser: vi.fn(),
	isAdmin: (user: { roles: string[] }) => user.roles.includes('admin'),
}));

import { query, type User } from '@specboard/db';
import { getCurrentUser } from './auth-utils.ts';
import { handleCreateUser, handleUpdateUser } from './users.ts';

const redis = {} as Redis;
const USER_ID = '6d229da7-5266-4027-a5d1-c5e229c104c9';

function user(overrides: Partial<User> = {}): User {
	return {
		id: USER_ID,
		username: 'jane_doe',
		slug: 'jane-doe',
		first_name: 'Jane',
		last_name: 'Doe',
		email: 'jane@example.com',
		email_verified: true,
		email_verified_at: null,
		phone_number: null,
		avatar_url: null,
		roles: [],
		is_active: true,
		deactivated_at: null,
		signup_metadata: {},
		created_at: new Date('2026-01-01'),
		updated_at: new Date('2026-01-01'),
		...overrides,
	};
}

function result(rows: pg.QueryResultRow[]): pg.QueryResult {
	return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function pgError(code: string, constraint: string): Error {
	return Object.assign(new Error(constraint), { code, constraint });
}

function createApp(): Hono {
	const app = new Hono();
	app.put('/api/users/:id', (c) => handleUpdateUser(c, redis));
	app.post('/api/users', (c) => handleCreateUser(c, redis));
	return app;
}

function send(method: 'PUT' | 'POST', path: string, body: unknown): Promise<Response> {
	return Promise.resolve(
		createApp().request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

/** SQL of every query call that includes `fragment`. */
function callsWith(fragment: string): Array<[string, unknown[]]> {
	return vi.mocked(query).mock.calls
		.filter((call) => String(call[0]).includes(fragment))
		.map((call) => [String(call[0]), call[1] as unknown[]]);
}

beforeEach(() => {
	vi.mocked(query).mockReset();
	vi.mocked(getCurrentUser).mockReset().mockResolvedValue(user());
});

describe('PUT /api/users/:id user slug', () => {
	it('lets a user change their own slug', async () => {
		vi.mocked(query).mockImplementation(async (sql) =>
			String(sql).startsWith('UPDATE users')
				? result([user({ slug: 'jd' })])
				: result([{ username: 'jane_doe' }])
		);

		const res = await send('PUT', '/api/users/me', { first_name: 'Jane', last_name: 'Doe', slug: 'jd' });

		expect(res.status).toBe(200);
		expect((await res.json()).slug).toBe('jd');
		const [sql, params] = callsWith('UPDATE users')[0]!;
		expect(sql).toContain('slug = $3');
		expect(params[2]).toBe('jd');
	});

	it('rejects an invalid slug before writing', async () => {
		vi.mocked(query).mockResolvedValue(result([{ username: 'jane_doe' }]));

		const res = await send('PUT', '/api/users/me', { slug: 'Jane_Doe' });

		expect(res.status).toBe(400);
		expect(callsWith('UPDATE users')).toHaveLength(0);
	});

	it('answers a taken slug with 409', async () => {
		vi.mocked(query).mockImplementation(async (sql) => {
			if (String(sql).startsWith('UPDATE users')) throw pgError('23505', 'idx_users_slug');
			return result([{ username: 'jane_doe' }]);
		});

		const res = await send('PUT', '/api/users/me', { slug: 'taken' });

		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe('User slug already taken');
	});

	it('gives a user an admin names a default slug without replacing an existing one', async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(user({ id: 'admin-id', roles: ['admin'] }));
		vi.mocked(query).mockImplementation(async (sql) =>
			String(sql).startsWith('UPDATE users') ? result([user()]) : result([])
		);

		await send('PUT', `/api/users/${USER_ID}`, { username: 'Jane_Doe' });

		const [sql, params] = callsWith('UPDATE users')[0]!;
		expect(sql).toContain('slug = COALESCE(slug, $2)');
		expect(params[1]).toBe('jane-doe');
	});
});

describe('POST /api/users default slug', () => {
	const BODY = {
		username: 'Jane_Doe',
		email: 'jane@example.com',
		password: 'password123',
		first_name: 'Jane',
		last_name: 'Doe',
	};

	beforeEach(() => {
		vi.mocked(getCurrentUser).mockResolvedValue(user({ id: 'admin-id', roles: ['admin'] }));
	});

	it('derives the slug from the username', async () => {
		vi.mocked(query).mockImplementation(async (sql) =>
			String(sql).startsWith('INSERT INTO users') ? result([user()]) : result([])
		);

		const res = await send('POST', '/api/users', BODY);

		expect(res.status).toBe(201);
		expect(callsWith('INSERT INTO users')[0]![1][1]).toBe('jane-doe');
	});

	it('suffixes the slug while it collides', async () => {
		let inserts = 0;
		vi.mocked(query).mockImplementation(async (sql) => {
			if (!String(sql).startsWith('INSERT INTO users')) return result([]);
			inserts++;
			if (inserts < 3) throw pgError('23505', 'idx_users_slug');
			return result([user({ slug: 'jane-doe-3' })]);
		});

		const res = await send('POST', '/api/users', BODY);

		expect(res.status).toBe(201);
		expect(callsWith('INSERT INTO users').map(([, params]) => params[1])).toEqual([
			'jane-doe',
			'jane-doe-2',
			'jane-doe-3',
		]);
	});

	it('still reports a username or email conflict as 409 without retrying', async () => {
		vi.mocked(query).mockImplementation(async (sql) => {
			if (String(sql).startsWith('INSERT INTO users')) throw pgError('23505', 'users_email_key');
			return result([]);
		});

		const res = await send('POST', '/api/users', BODY);

		expect(res.status).toBe(409);
		expect(callsWith('INSERT INTO users')).toHaveLength(1);
	});
});
