/**
 * Project handler tests.
 *
 * Focus: a repository can be attached to an existing project through PUT, using the
 * same validation as create, and only when the project has no repository yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { ProjectResponse } from '@specboard/db';

vi.mock('@specboard/db', () => ({
	getProjects: vi.fn(),
	getProjectBySlug: vi.fn(),
	resolveProjectSlug: vi.fn(),
	createProject: vi.fn(),
	updateProject: vi.fn(),
	deleteProject: vi.fn(),
	ProjectIdentifierTakenError: class extends Error {
		field = 'slug';
	},
	ProjectHasRepositoryError: class extends Error {},
}));

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session',
}));

vi.mock('./github-sync.ts', () => ({
	startGitHubInitialSync: vi.fn(async () => undefined),
}));

import { getSession } from '@specboard/auth';
import { resolveProjectSlug, createProject, updateProject, ProjectHasRepositoryError } from '@specboard/db';
import { startGitHubInitialSync } from './github-sync.ts';
import { handleCreateProject, handleUpdateProject } from './projects.ts';

const REPOSITORY = {
	provider: 'github',
	owner: 'acme-corp',
	repo: 'documentation',
	branch: 'main',
	url: 'https://github.com/acme-corp/documentation',
};

function projectResponse(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
	return {
		id: 'proj-1',
		slug: 'docs',
		key: 'DOCS',
		name: 'Docs',
		description: null,
		ownerId: 'user-1',
		storageMode: 'none',
		repository: {},
		rootPaths: [],
		systemPrompt: null,
		syncStatus: null,
		syncError: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

const redis = {} as Redis;

function createApp(): Hono {
	const app = new Hono();
	app.post('/api/projects', (context) => handleCreateProject(context, redis));
	app.put('/api/projects/:projectSlug', (context) => handleUpdateProject(context, redis));
	return app;
}

function request(method: 'POST' | 'PUT', path: string, body: unknown): Promise<Response> {
	return Promise.resolve(
		createApp().request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Cookie: 'session=sess-1' },
			body: JSON.stringify(body),
		})
	);
}

const put = (body: unknown): Promise<Response> => request('PUT', '/api/projects/docs', body);
const post = (body: unknown): Promise<Response> => request('POST', '/api/projects', body);

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getSession).mockResolvedValue({
		userId: 'user-1',
		csrfToken: 'csrf',
		createdAt: Date.now(),
		lastAccessedAt: Date.now(),
	});
	vi.mocked(resolveProjectSlug).mockResolvedValue({ id: 'proj-1', slug: 'docs', key: 'DOCS' });
	vi.mocked(updateProject).mockResolvedValue(projectResponse());
	vi.mocked(createProject).mockResolvedValue(projectResponse());
});

describe('handleUpdateProject', () => {
	it('attaches a repository and starts the initial sync', async () => {
		vi.mocked(updateProject).mockResolvedValue(projectResponse({
			storageMode: 'cloud',
			repository: { type: 'cloud', remote: { provider: 'github', owner: 'acme-corp', repo: 'documentation', url: REPOSITORY.url }, branch: 'main' },
			rootPaths: ['/'],
		}));

		const res = await put({ name: 'Docs', repository: REPOSITORY });

		expect(res.status).toBe(200);
		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', 'user-1', expect.objectContaining({
			name: 'Docs',
			repository: REPOSITORY,
		}));
		expect(vi.mocked(startGitHubInitialSync)).toHaveBeenCalledWith('proj-1', 'user-1');
		const body = await res.json() as { storageMode: string };
		expect(body.storageMode).toBe('cloud');
	});

	it('leaves the repository alone and starts no sync when the body has none', async () => {
		const res = await put({ name: 'Renamed' });

		expect(res.status).toBe(200);
		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', 'user-1', expect.objectContaining({ repository: undefined }));
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it('returns 409 when the project already has a repository', async () => {
		vi.mocked(updateProject).mockRejectedValue(new ProjectHasRepositoryError());

		const res = await put({ repository: REPOSITORY });

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: 'REPOSITORY_ALREADY_SET' });
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it.each([
		['a non-GitHub provider', { ...REPOSITORY, provider: 'gitlab' }, 'Invalid repository configuration'],
		['a missing branch', { ...REPOSITORY, branch: undefined }, 'Invalid repository configuration'],
		['an owner with a leading dot', { ...REPOSITORY, owner: '.acme' }, 'Invalid repository owner format'],
		['a repo name with a space', { ...REPOSITORY, repo: 'my docs' }, 'Invalid repository name format'],
		['a branch starting with a hyphen', { ...REPOSITORY, branch: '-main' }, 'Invalid branch name format'],
		['a non-GitHub URL', { ...REPOSITORY, url: 'https://gitlab.com/acme-corp/documentation' }, 'Repository URL must be a GitHub URL'],
		['a URL without a repo path', { ...REPOSITORY, url: 'https://github.com/acme-corp' }, 'Repository URL must be in format https://github.com/{owner}/{repo}'],
		['an unparseable URL', { ...REPOSITORY, url: 'not a url' }, 'Invalid repository URL'],
	])('rejects %s with 400 before touching the database', async (_label, repository, error) => {
		const res = await put({ repository });

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error });
		expect(vi.mocked(updateProject)).not.toHaveBeenCalled();
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it('accepts a .git URL and passes only the stored fields through', async () => {
		await put({ repository: { ...REPOSITORY, url: 'https://github.com/acme-corp/documentation.git', extra: 'ignored' } });

		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', 'user-1', expect.objectContaining({
			repository: { ...REPOSITORY, url: 'https://github.com/acme-corp/documentation.git' },
		}));
	});

	it('returns 404 without validating anything else when the slug is not the caller\'s', async () => {
		vi.mocked(resolveProjectSlug).mockResolvedValue(null);

		const res = await put({ repository: REPOSITORY });

		expect(res.status).toBe(404);
		expect(vi.mocked(updateProject)).not.toHaveBeenCalled();
	});
});

describe('handleCreateProject', () => {
	it('validates the repository with the same rules as update', async () => {
		const res = await post({ name: 'Docs', repository: { ...REPOSITORY, owner: '.acme' } });

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid repository owner format' });
		expect(vi.mocked(createProject)).not.toHaveBeenCalled();
	});

	it('creates a cloud project and starts the initial sync', async () => {
		const res = await post({ name: 'Docs', repository: REPOSITORY });

		expect(res.status).toBe(201);
		expect(vi.mocked(createProject)).toHaveBeenCalledWith('user-1', expect.objectContaining({ repository: REPOSITORY }));
		expect(vi.mocked(startGitHubInitialSync)).toHaveBeenCalledWith('proj-1', 'user-1');
	});

	it('creates a project without a repository and starts no sync', async () => {
		const res = await post({ name: 'Docs' });

		expect(res.status).toBe(201);
		expect(vi.mocked(createProject)).toHaveBeenCalledWith('user-1', expect.objectContaining({ repository: undefined }));
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});
});
