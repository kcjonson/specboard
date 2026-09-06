/**
 * Folder route registration tests.
 *
 * The folder routes stat an arbitrary path on the API host and run git there, so they
 * must not exist at all in the cloud build. The gate is the LOCAL_STORAGE_ENABLED flag,
 * read once at registration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

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

import { resolveProjectSlug } from '@specboard/db';
import { registerFolderRoutes } from './folder-handlers.ts';

const FOLDERS_URL = 'http://localhost/api/projects/specboard/folders';

function createApp(): Hono {
	const app = new Hono();
	registerFolderRoutes(app, {} as never);
	return app;
}

function request(app: Hono, method: 'POST' | 'DELETE'): Promise<Response> {
	return Promise.resolve(
		app.request(`${FOLDERS_URL}?path=/docs`, {
			method,
			headers: { 'Content-Type': 'application/json' },
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

	it('does not mount the folder routes unless LOCAL_STORAGE_ENABLED is true', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '');
		const app = createApp();

		expect((await request(app, 'POST')).status).toBe(404);
		expect((await request(app, 'DELETE')).status).toBe(404);
		expect(resolveProjectSlug).not.toHaveBeenCalled();
	});

	it('treats any value other than "true" as disabled', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', '1');
		const app = createApp();

		expect((await request(app, 'POST')).status).toBe(404);
	});

	it('mounts the folder routes when LOCAL_STORAGE_ENABLED is true', async () => {
		vi.stubEnv('LOCAL_STORAGE_ENABLED', 'true');
		const app = createApp();

		// No session cookie, so the handler itself answers rather than the router
		expect((await request(app, 'POST')).status).toBe(401);
		expect((await request(app, 'DELETE')).status).toBe(401);
	});
});
