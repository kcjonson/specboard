/**
 * Adding a folder stats an arbitrary host path and runs git there, so that route must not
 * exist in the cloud build. LOCAL_STORAGE_ENABLED gates it, read once at registration.
 * Where the routes do exist, a cloud project must refuse both of them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

vi.mock('@specboard/db', () => ({
	addFolder: vi.fn(),
	removeFolder: vi.fn(),
	resolveProjectSlug: vi.fn(),
	getProject: vi.fn(),
	isLocalRepository: vi.fn(() => false),
	isCloudRepository: vi.fn(() => false),
}));

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session',
}));

vi.mock('../../services/storage/git-utils.ts', () => ({
	findRepoRoot: vi.fn(async () => '/etc'),
	getCurrentBranch: vi.fn(async () => 'main'),
	getRelativePath: vi.fn(() => '/'),
}));

import { getSession } from '@specboard/auth';
import { addFolder, removeFolder, resolveProjectSlug } from '@specboard/db';
import { registerFolderRoutes } from './folder-handlers.ts';

const FOLDERS_URL = 'http://localhost/api/projects/specboard/folders?path=/docs';
const redis = {} as Redis;

function createApp(): Hono {
	const app = new Hono();
	registerFolderRoutes(app, redis);
	return app;
}

function request(app: Hono, method: 'POST' | 'DELETE', cookie?: string): Promise<Response> {
	return Promise.resolve(
		app.request(FOLDERS_URL, {
			method,
			headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
			body: method === 'POST' ? JSON.stringify({ path: '/etc' }) : undefined,
		})
	);
}

describe('registerFolderRoutes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('does not mount POST unless LOCAL_STORAGE_ENABLED is true', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '');
		const app = createApp();

		expect((await request(app, 'POST')).status).toBe(404);
		expect(resolveProjectSlug).not.toHaveBeenCalled();
	});

	it('treats any value other than "true" as disabled', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '1');

		expect((await request(createApp(), 'POST')).status).toBe(404);
	});

	it('mounts POST when LOCAL_STORAGE_ENABLED is true', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');

		// No session cookie, so the handler answers rather than the router
		expect((await request(createApp(), 'POST')).status).toBe(401);
	});

	it('reads the flag at registration, not per request', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');
		const app = createApp();
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '');

		expect((await request(app, 'POST')).status).toBe(401);
	});

	it('always mounts DELETE, which is a plain DB write', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '');

		expect((await request(createApp(), 'DELETE')).status).toBe(401);
	});
});

describe('folder routes on a cloud project', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');
		vi.mocked(getSession).mockResolvedValue({ userId: 'user-1' } as never);
		vi.mocked(resolveProjectSlug).mockResolvedValue({ id: 'proj-1' } as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('answers 409 CLOUD_PROJECT when adding a folder', async () => {
		vi.mocked(addFolder).mockRejectedValue(new Error('CLOUD_PROJECT'));

		const res = await request(createApp(), 'POST', 'session=abc');

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: 'CLOUD_PROJECT' });
		expect(addFolder).toHaveBeenCalledWith('proj-1', 'user-1', { repoPath: '/etc', rootPath: '/', branch: 'main' });
	});

	it('answers 409 CLOUD_PROJECT when removing a folder', async () => {
		vi.mocked(removeFolder).mockRejectedValue(new Error('CLOUD_PROJECT'));

		const res = await request(createApp(), 'DELETE', 'session=abc');

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: 'CLOUD_PROJECT' });
		expect(removeFolder).toHaveBeenCalledWith('proj-1', 'user-1', '/docs');
	});
});
