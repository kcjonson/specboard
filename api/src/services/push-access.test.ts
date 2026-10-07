/**
 * Push access: GitHub's `permissions.push` for a member's own token, cached briefly, and
 * never allowed to hold a response past its budget. GitHub, Redis and the token store are
 * stand-ins; the rules under test are what each GitHub answer becomes, what gets cached,
 * and what a slow or failing GitHub costs a request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { ProjectResponse } from '@specboard/db';

vi.mock('@specboard/auth', () => ({
	decrypt: vi.fn((data: { token: string }) => data.token),
}));

vi.mock('@specboard/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/db')>();
	return {
		isCloudRepository: actual.isCloudRepository,
		query: vi.fn(),
		getProjects: vi.fn(async () => []),
	};
});

vi.mock('./github-token.ts', () => ({
	getEncryptedGitHubToken: vi.fn(),
}));

import { getProjects, query } from '@specboard/db';
import { getEncryptedGitHubToken } from './github-token.ts';
import {
	callerPushAccess,
	forgetPushAccess,
	memberPushAccess,
	warmPushAccess,
	PUSH_ACCESS_TTL_SECONDS,
	PUSH_CHECK_BUDGET_MS,
} from './push-access.ts';

/** Enough of Redis for the cache: get, setex (TTL recorded), keys by prefix, del. */
function fakeRedis(): Redis & { store: Map<string, string>; ttls: Map<string, number> } {
	const store = new Map<string, string>();
	const ttls = new Map<string, number>();
	return {
		store,
		ttls,
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		setex: vi.fn(async (key: string, ttl: number, value: string) => {
			store.set(key, value);
			ttls.set(key, ttl);
			return 'OK';
		}),
		keys: vi.fn(async (pattern: string) => [...store.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/, '')))),
		del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
	} as unknown as Redis & { store: Map<string, string>; ttls: Map<string, number> };
}

function token(value: string): string {
	return JSON.stringify({ token: value });
}

function cloudProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
	return {
		id: 'proj-1',
		slug: 'docs',
		ownerSlug: 'acme',
		ownerName: 'Alice Ames',
		key: 'DOCS',
		name: 'Docs',
		description: null,
		storageMode: 'cloud',
		repository: {
			type: 'cloud',
			remote: { provider: 'github', owner: 'Acme-Corp', repo: 'Documentation', url: 'https://github.com/Acme-Corp/Documentation' },
			branch: 'main',
		},
		rootPaths: ['/'],
		systemPrompt: null,
		syncStatus: 'completed',
		syncError: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

function githubAnswers(status: number, body: unknown = {}): void {
	vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn());
	redis = fakeRedis();
	vi.mocked(getEncryptedGitHubToken).mockResolvedValue(token('gho_vera'));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('callerPushAccess', () => {
	it('reads permissions.push with the caller\'s own token', async () => {
		githubAnswers(200, { permissions: { admin: false, push: true, pull: true } });

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBe(true);

		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe('https://api.github.com/repos/Acme-Corp/Documentation');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gho_vera');
	});

	it('reports a collaborator with read access as false', async () => {
		githubAnswers(200, { permissions: { push: false, pull: true } });

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBe(false);
	});

	it('reports a private repository the token can\'t see (404) as false', async () => {
		githubAnswers(404, { message: 'Not Found' });

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBe(false);
	});

	it('caches answers for the TTL, keyed case-insensitively per user and repository', async () => {
		githubAnswers(200, { permissions: { push: true } });

		await callerPushAccess(redis, 'user-vera', cloudProject());

		expect([...redis.store]).toEqual([['github_push:v1:user-vera:acme-corp/documentation', '1']]);
		expect(redis.ttls.get('github_push:v1:user-vera:acme-corp/documentation')).toBe(PUSH_ACCESS_TTL_SECONDS);
	});

	it('answers from the cache without asking GitHub', async () => {
		redis.store.set('github_push:v1:user-vera:acme-corp/documentation', '0');

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		['an expired token (401)', 401],
		['a rate limit (403)', 403],
		['a GitHub outage (502)', 502],
	])('reports %s as null and caches nothing', async (_what, status) => {
		githubAnswers(status, { message: 'nope' });

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBeNull();
		expect(redis.store.size).toBe(0);
	});

	it('reports a body without permissions as null', async () => {
		githubAnswers(200, { full_name: 'Acme-Corp/Documentation' });

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBeNull();
	});

	it('reports a network failure as null', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBeNull();
		expect(redis.store.size).toBe(0);
	});

	it('gives up after the budget with null, and the late answer still fills the cache', async () => {
		vi.useFakeTimers();
		let answer!: (response: Response) => void;
		vi.mocked(fetch).mockReturnValue(new Promise((resolve) => {
			answer = resolve;
		}));

		const pending = callerPushAccess(redis, 'user-vera', cloudProject());
		await vi.advanceTimersByTimeAsync(PUSH_CHECK_BUDGET_MS);
		expect(await pending).toBeNull();

		answer(new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }));
		await vi.waitFor(() => expect(redis.store.get('github_push:v1:user-vera:acme-corp/documentation')).toBe('1'));
	});

	it('shares one GitHub call between concurrent reads', async () => {
		githubAnswers(200, { permissions: { push: true } });

		const answers = await Promise.all([
			callerPushAccess(redis, 'user-vera', cloudProject()),
			callerPushAccess(redis, 'user-vera', cloudProject()),
		]);

		expect(answers).toEqual([true, true]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		['a planning-only project', { storageMode: 'none', repository: {} }],
		['a local project', { storageMode: 'local', repository: { type: 'local', localPath: '/Users/alice/docs', branch: 'main' } }],
	] as const)('is null for %s without asking anyone', async (_what, overrides) => {
		expect(await callerPushAccess(redis, 'user-vera', cloudProject(overrides as Partial<ProjectResponse>))).toBeNull();
		expect(getEncryptedGitHubToken).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('is null for a caller without a GitHub connection', async () => {
		vi.mocked(getEncryptedGitHubToken).mockResolvedValue(null);

		expect(await callerPushAccess(redis, 'user-vera', cloudProject())).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('memberPushAccess', () => {
	it('checks each connected member with their own token, keyed by slug', async () => {
		vi.mocked(query).mockResolvedValue({
			rows: [
				{ id: 'user-alice', slug: 'alice', access_token: token('gho_alice') },
				{ id: 'user-vera', slug: 'vera', access_token: token('gho_vera') },
			],
		} as never);
		vi.mocked(fetch).mockImplementation(async (_url, init) => {
			const auth = (init?.headers as Record<string, string>).Authorization;
			return new Response(JSON.stringify({ permissions: { push: auth === 'Bearer gho_alice' } }), { status: 200 });
		});

		const access = await memberPushAccess(redis, cloudProject());

		expect([...access]).toEqual([['alice', true], ['vera', false]]);
		expect(vi.mocked(query).mock.calls[0]![1]).toEqual(['proj-1']);
	});

	it('is empty for a project without a cloud repository', async () => {
		const access = await memberPushAccess(redis, cloudProject({ storageMode: 'none', repository: {} }));

		expect(access.size).toBe(0);
		expect(query).not.toHaveBeenCalled();
	});
});

describe('connecting and disconnecting GitHub', () => {
	it('forgets only that user\'s answers', async () => {
		redis.store.set('github_push:v1:user-vera:acme-corp/documentation', '0');
		redis.store.set('github_push:v1:user-vera:acme-corp/website', '1');
		redis.store.set('github_push:v1:user-alice:acme-corp/documentation', '1');

		await forgetPushAccess(redis, 'user-vera');

		expect([...redis.store.keys()]).toEqual(['github_push:v1:user-alice:acme-corp/documentation']);
	});

	it('warms the cache for the user\'s cloud projects', async () => {
		vi.mocked(getProjects).mockResolvedValue([
			{ ...cloudProject(), itemCount: 0, itemCounts: { ready: 0, in_progress: 0, in_review: 0, done: 0 }, grantedRole: 'editor', effectiveRole: 'editor' },
			{ ...cloudProject({ id: 'proj-2', storageMode: 'none', repository: {} }), itemCount: 0, itemCounts: { ready: 0, in_progress: 0, in_review: 0, done: 0 }, grantedRole: 'owner', effectiveRole: 'owner' },
		]);
		githubAnswers(200, { permissions: { push: false } });

		await warmPushAccess(redis, 'user-vera');

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(redis.store.get('github_push:v1:user-vera:acme-corp/documentation')).toBe('0');
	});
});
