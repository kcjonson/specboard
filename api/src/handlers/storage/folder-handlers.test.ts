/**
 * A cloud project must refuse both folder routes. Who may call them (the owner) is
 * requireProjectAccess's job and whether POST is mounted at all is the route table's
 * (LOCAL_STORAGE_ENABLED); both are covered by the role-matrix suite. Here the
 * handlers sit behind a stand-in that authorizes the owner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@specboard/db', () => ({
	addFolder: vi.fn(),
	removeFolder: vi.fn(),
	getProject: vi.fn(),
	isLocalRepository: vi.fn(() => false),
	isCloudRepository: vi.fn(() => false),
}));

vi.mock('../../services/storage/git-utils.ts', () => ({
	findRepoRoot: vi.fn(async () => '/etc'),
	getCurrentBranch: vi.fn(async () => 'main'),
	getRelativePath: vi.fn(() => '/'),
}));

import { addFolder, removeFolder } from '@specboard/db';
import { handleAddFolder, handleRemoveFolder } from './folder-handlers.ts';
import type { AppVariables } from '../../project-access.ts';

const FOLDERS_URL = 'http://localhost/api/projects/acme/specboard/folders?path=/docs';

function createApp(): Hono<{ Variables: AppVariables }> {
	const app = new Hono<{ Variables: AppVariables }>();
	app.use('/api/projects/:owner/:project/*', async (context, next) => {
		context.set('project', { id: 'proj-1', slug: 'specboard', key: 'SB', ownerSlug: 'acme' });
		context.set('userId', 'user-1');
		await next();
	});
	app.post('/api/projects/:owner/:project/folders', handleAddFolder);
	app.delete('/api/projects/:owner/:project/folders', handleRemoveFolder);
	return app;
}

function request(method: 'POST' | 'DELETE'): Promise<Response> {
	return Promise.resolve(
		createApp().request(FOLDERS_URL, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: method === 'POST' ? JSON.stringify({ path: '/etc' }) : undefined,
		})
	);
}

describe('folder routes on a cloud project', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('answers 409 CLOUD_PROJECT when adding a folder', async () => {
		vi.mocked(addFolder).mockRejectedValue(new Error('CLOUD_PROJECT'));

		const res = await request('POST');

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: 'CLOUD_PROJECT' });
		expect(addFolder).toHaveBeenCalledWith('proj-1', { repoPath: '/etc', rootPath: '/', branch: 'main' });
	});

	it('answers 409 CLOUD_PROJECT when removing a folder', async () => {
		vi.mocked(removeFolder).mockRejectedValue(new Error('CLOUD_PROJECT'));

		const res = await request('DELETE');

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: 'CLOUD_PROJECT' });
		expect(removeFolder).toHaveBeenCalledWith('proj-1', '/docs');
	});
});
