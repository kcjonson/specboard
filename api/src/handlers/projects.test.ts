/**
 * Project handler tests.
 *
 * Focus: a repository can be attached to an existing project through PUT, using the
 * same validation as create, and only when the project has no repository yet. Who may
 * call PUT is requireProjectAccess's job (owner only), covered by the role-matrix
 * suite; here the route is mounted behind a stand-in that authorizes the owner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { Redis } from 'ioredis';
import type { ProjectAccess, ProjectResponse } from '@specboard/db';

vi.mock('@specboard/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/db')>();
	return {
		isLocalRepository: actual.isLocalRepository,
		getProjects: vi.fn(),
		getProject: vi.fn(),
		createProject: vi.fn(),
		updateProject: vi.fn(),
		deleteProject: vi.fn(),
		ProjectIdentifierTakenError: class extends Error {},
		ProjectHasRepositoryError: class extends Error {
			constructor() {
				super('Project already has a repository');
			}
		},
		ProjectOwnerWithoutSlugError: class extends Error {
			constructor() {
				super('Finish onboarding before creating a project');
			}
		},
	};
});

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session',
}));

vi.mock('./github-sync.ts', () => ({
	startGitHubInitialSync: vi.fn(async () => undefined),
	markSyncStartFailed: vi.fn(async () => undefined),
}));

vi.mock('../services/push-access.ts', () => ({
	callerPushAccess: vi.fn(async () => null),
}));

vi.mock('../services/github-token.ts', () => ({
	getGitHubConnection: vi.fn(async () => null),
}));

import { getSession } from '@specboard/auth';
import { createProject, getProject, updateProject, ProjectHasRepositoryError, ProjectOwnerWithoutSlugError } from '@specboard/db';
import { startGitHubInitialSync, markSyncStartFailed } from './github-sync.ts';
import { callerPushAccess } from '../services/push-access.ts';
import { getGitHubConnection } from '../services/github-token.ts';
import { handleCreateProject, handleGetProject, handleUpdateProject } from './projects.ts';
import type { AppVariables } from '../project-access.ts';

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
		ownerSlug: 'acme',
		ownerName: 'Alice Ames',
		key: 'DOCS',
		name: 'Docs',
		description: null,
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

const OWNER_ACCESS: ProjectAccess = {
	project: { id: 'proj-1', slug: 'docs', key: 'DOCS', ownerSlug: 'acme' },
	grantedRole: 'owner',
	effectiveRole: 'owner',
};

function createApp(access: ProjectAccess = OWNER_ACCESS): Hono<{ Variables: AppVariables }> {
	const app = new Hono<{ Variables: AppVariables }>();
	const authorize = async (context: Context, next: Next): Promise<void> => {
		context.set('access', access);
		context.set('project', access.project);
		context.set('userId', 'user-1');
		await next();
	};
	app.post('/api/projects', (context) => handleCreateProject(context, redis));
	app.get('/api/projects/:owner/:project', authorize, (context) => handleGetProject(context, redis));
	app.put('/api/projects/:owner/:project', authorize, handleUpdateProject);
	return app;
}

function request(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, access?: ProjectAccess): Promise<Response> {
	return Promise.resolve(
		createApp(access).request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Cookie: 'session=sess-1' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
	);
}

const put = (body: unknown): Promise<Response> => request('PUT', '/api/projects/acme/docs', body);
const post = (body: unknown): Promise<Response> => request('POST', '/api/projects', body);

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getSession).mockResolvedValue({
		userId: 'user-1',
		csrfToken: 'csrf',
		createdAt: Date.now(),
	});
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
		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', expect.objectContaining({
			name: 'Docs',
			repository: REPOSITORY,
		}));
		expect(vi.mocked(startGitHubInitialSync)).toHaveBeenCalledWith('proj-1', 'user-1');
		const body = await res.json() as { storageMode: string };
		expect(body.storageMode).toBe('cloud');
	});

	it.each([
		['omitted', { name: 'Renamed' }],
		['null', { name: 'Renamed', repository: null }],
	])('leaves the repository alone and starts no sync when the body\'s repository is %s', async (_label, body) => {
		const res = await put(body);

		expect(res.status).toBe(200);
		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', expect.objectContaining({ repository: undefined }));
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it('records a sync that could not start on the project instead of failing the request', async () => {
		vi.mocked(startGitHubInitialSync).mockRejectedValueOnce(new Error('GitHub not connected'));

		const res = await put({ repository: REPOSITORY });

		expect(res.status).toBe(200);
		await vi.waitFor(() => {
			expect(vi.mocked(markSyncStartFailed)).toHaveBeenCalledWith('proj-1', 'GitHub not connected');
		});
	});

	it('returns 409 when the project already has a repository', async () => {
		vi.mocked(updateProject).mockRejectedValue(new ProjectHasRepositoryError());

		const res = await put({ repository: REPOSITORY });

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'Project already has a repository', code: 'REPOSITORY_ALREADY_SET' });
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it.each([
		['a non-GitHub provider', { ...REPOSITORY, provider: 'gitlab' }, 'Invalid repository configuration'],
		['a missing branch', { ...REPOSITORY, branch: undefined }, 'Invalid repository configuration'],
		['an owner with a leading dot', { ...REPOSITORY, owner: '.acme' }, 'Invalid repository owner format'],
		['a repo name with a space', { ...REPOSITORY, repo: 'my docs' }, 'Invalid repository name format'],
		['a branch starting with a hyphen', { ...REPOSITORY, branch: '-main' }, 'Invalid branch name format'],
		['a non-GitHub URL', { ...REPOSITORY, url: 'https://gitlab.com/acme-corp/documentation' }, 'Repository URL must be a GitHub URL'],
		['a plain-http GitHub URL', { ...REPOSITORY, url: 'http://github.com/acme-corp/documentation' }, 'Repository URL must be a GitHub URL'],
		['a URL naming a different repository', { ...REPOSITORY, url: 'https://github.com/acme-corp/other' }, 'Repository URL does not match the repository owner and name'],
		['a URL without a repo path', { ...REPOSITORY, url: 'https://github.com/acme-corp' }, 'Repository URL must be in format https://github.com/{owner}/{repo}'],
		['an unparseable URL', { ...REPOSITORY, url: 'not a url' }, 'Invalid repository URL'],
	])('rejects %s with 400 before touching the database', async (_label, repository, error) => {
		const res = await put({ repository });

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error });
		expect(vi.mocked(updateProject)).not.toHaveBeenCalled();
		expect(vi.mocked(startGitHubInitialSync)).not.toHaveBeenCalled();
	});

	it('accepts a .git URL that differs only in case and passes only the stored fields through', async () => {
		await put({ repository: { ...REPOSITORY, url: 'https://github.com/Acme-Corp/Documentation.git', extra: 'ignored' } });

		expect(vi.mocked(updateProject)).toHaveBeenCalledWith('proj-1', expect.objectContaining({
			repository: { ...REPOSITORY, url: 'https://github.com/Acme-Corp/Documentation.git' },
		}));
	});
});

describe('handleCreateProject', () => {
	it('refuses with 403 when the caller has no user slug to address the project by', async () => {
		vi.mocked(createProject).mockRejectedValue(new ProjectOwnerWithoutSlugError());

		const res = await post({ name: 'Docs' });

		expect(res.status).toBe(403);
	});

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

describe('handleGetProject', () => {
	const EDITOR_ACCESS: ProjectAccess = { ...OWNER_ACCESS, grantedRole: 'editor', effectiveRole: 'editor' };

	it('answers with the caller\'s roles, the owner\'s name, their GitHub login and push access', async () => {
		const project = projectResponse({ storageMode: 'cloud' });
		vi.mocked(getProject).mockResolvedValue(project);
		vi.mocked(getGitHubConnection).mockResolvedValue({ encryptedToken: 'sealed', username: 'vera' });
		vi.mocked(callerPushAccess).mockResolvedValue(false);

		const res = await request('GET', '/api/projects/acme/docs', undefined, EDITOR_ACCESS);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			ownerName: 'Alice Ames',
			grantedRole: 'editor',
			effectiveRole: 'editor',
			githubUsername: 'vera',
			pushAccess: false,
		});
		expect(JSON.stringify(body)).not.toContain('sealed');
		expect(callerPushAccess).toHaveBeenCalledWith(redis, 'user-1', 'sealed', project);
	});

	it('sends nulls for a caller without GitHub', async () => {
		vi.mocked(getProject).mockResolvedValue(projectResponse());
		vi.mocked(getGitHubConnection).mockResolvedValue(null);
		vi.mocked(callerPushAccess).mockResolvedValue(null);

		const res = await request('GET', '/api/projects/acme/docs');

		expect(await res.json()).toMatchObject({ githubUsername: null, pushAccess: null });
		expect(callerPushAccess).toHaveBeenCalledWith(redis, 'user-1', null, expect.anything());
	});
});
