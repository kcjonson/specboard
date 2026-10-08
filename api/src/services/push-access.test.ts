/**
 * Push access: GitHub's `permissions.push` for a member's own token, cached briefly, and
 * never allowed to hold up a project page. GitHub, Redis and the token store are
 * stand-ins; the rules under test are what each GitHub answer becomes, what gets cached
 * and for how long, and what a slow or failing GitHub costs a request.
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
	getGitHubConnection: vi.fn(),
}));

import { getProjects, query } from '@specboard/db';
import { getGitHubConnection } from './github-token.ts';
import {
	callerPushAccess,
	forgetPushAccess,
	memberPushAccess,
	warmPushAccess,
	PUSH_ACCESS_TTL_SECONDS,
	PUSH_CHECK_BUDGET_MS,
	PUSH_FAILURE_TTL_SECONDS,
} from './push-access.ts';

/** Enough of Redis for the cache: get, setex (TTL recorded), scan by prefix, del. */
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
		scan: vi.fn(async (_cursor: string, _match: string, pattern: string) =>
			['0', [...store.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/, '')))]),
		del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
	} as unknown as Redis & { store: Map<string, string>; ttls: Map<string, number> };
}

function token(value: string): string {
	return JSON.stringify({ token: value });
}

const VERA = token('gho_vera');

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

function members(rows: Array<{ id: string; slug: string; access_token: string }>): void {
	vi.mocked(query).mockResolvedValue({ rows } as never);
}

/** The one cached entry for a user, once the background check has written it. */
async function cachedFor(userId: string): Promise<{ key: string; value: string; ttl: number | undefined }> {
	let entry: [string, string] | undefined;
	await vi.waitFor(() => {
		entry = [...redis.store].find(([key]) => key.startsWith(`github_push:v1:${userId}:`));
		expect(entry).toBeDefined();
	});
	return { key: entry![0], value: entry![1], ttl: redis.ttls.get(entry![0]) };
}

/** The caller's answer once a first page view has started the check and it has landed. */
async function settledCallerAccess(project = cloudProject()): Promise<boolean | null> {
	expect(await callerPushAccess(redis, 'user-vera', VERA, project)).toBeNull();
	await cachedFor('user-vera');
	return callerPushAccess(redis, 'user-vera', VERA, project);
}

let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn());
	redis = fakeRedis();
	vi.mocked(getGitHubConnection).mockResolvedValue({ encryptedToken: VERA, username: 'vera' });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('callerPushAccess', () => {
	it('answers null at once on a miss and checks in the background, with the caller\'s own token', async () => {
		githubAnswers(200, { permissions: { admin: false, push: true, pull: true } });

		expect(await settledCallerAccess()).toBe(true);

		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe('https://api.github.com/repos/Acme-Corp/Documentation');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gho_vera');
	});

	it('doesn\'t wait on a slow GitHub', async () => {
		vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

		// A token of its own: this check never settles, and nothing else should join it.
		expect(await callerPushAccess(redis, 'user-vera', token('gho_slow'), cloudProject())).toBeNull();
	});

	it('reports a collaborator with read access as false', async () => {
		githubAnswers(200, { permissions: { push: false, pull: true } });

		expect(await settledCallerAccess()).toBe(false);
	});

	it('reports a private repository the token can\'t see (404) as false', async () => {
		githubAnswers(404, { message: 'Not Found' });

		expect(await settledCallerAccess()).toBe(false);
	});

	it('caches an answer for the TTL, keyed case-insensitively per user, connection and repository', async () => {
		githubAnswers(200, { permissions: { push: true } });

		await callerPushAccess(redis, 'user-vera', VERA, cloudProject());
		const { key, value, ttl } = await cachedFor('user-vera');

		expect(key).toMatch(/^github_push:v1:user-vera:[0-9a-f]{16}:acme-corp\/documentation$/);
		expect(key).not.toContain('gho_vera');
		expect(value).toBe('1');
		expect(ttl).toBe(PUSH_ACCESS_TTL_SECONDS);
	});

	it('answers from the cache without asking GitHub again', async () => {
		githubAnswers(200, { permissions: { push: false } });
		await settledCallerAccess();

		expect(await callerPushAccess(redis, 'user-vera', VERA, cloudProject())).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('doesn\'t read another connection\'s answer: a reconnect is asked afresh', async () => {
		githubAnswers(200, { permissions: { push: false } });
		await settledCallerAccess();

		githubAnswers(200, { permissions: { push: true } });
		const otherAccount = token('gho_vera_work');
		expect(await callerPushAccess(redis, 'user-vera', otherAccount, cloudProject())).toBeNull();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
	});

	it.each([
		['an expired token (401)', 401],
		['a rate limit (403)', 403],
		['a GitHub outage (502)', 502],
	])('reports %s as null, cached briefly so it isn\'t re-asked every load', async (_what, status) => {
		githubAnswers(status, { message: 'nope' });

		expect(await settledCallerAccess()).toBeNull();
		const { value, ttl } = await cachedFor('user-vera');
		expect(value).toBe('?');
		expect(ttl).toBe(PUSH_FAILURE_TTL_SECONDS);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('reports a body without permissions as null', async () => {
		githubAnswers(200, { full_name: 'Acme-Corp/Documentation' });

		expect(await settledCallerAccess()).toBeNull();
	});

	it('reports a network failure as null, cached briefly', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

		expect(await settledCallerAccess()).toBeNull();
		expect((await cachedFor('user-vera')).ttl).toBe(PUSH_FAILURE_TTL_SECONDS);
	});

	it('shares one GitHub call between concurrent reads', async () => {
		githubAnswers(200, { permissions: { push: true } });

		await Promise.all([
			callerPushAccess(redis, 'user-vera', VERA, cloudProject()),
			callerPushAccess(redis, 'user-vera', VERA, cloudProject()),
		]);
		await cachedFor('user-vera');

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		['a planning-only project', { storageMode: 'none', repository: {} }],
		['a local project', { storageMode: 'local', repository: { type: 'local', localPath: '/Users/alice/docs', branch: 'main' } }],
	] as const)('is null for %s without asking anyone', async (_what, overrides) => {
		expect(await callerPushAccess(redis, 'user-vera', VERA, cloudProject(overrides as Partial<ProjectResponse>))).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('is null for a caller without a GitHub connection', async () => {
		expect(await callerPushAccess(redis, 'user-vera', null, cloudProject())).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('memberPushAccess', () => {
	it('checks each connected member with their own token, keyed by slug', async () => {
		members([
			{ id: 'user-alice', slug: 'alice', access_token: token('gho_alice') },
			{ id: 'user-vera', slug: 'vera', access_token: VERA },
		]);
		vi.mocked(fetch).mockImplementation(async (_url, init) => {
			const auth = (init?.headers as Record<string, string>).Authorization;
			return new Response(JSON.stringify({ permissions: { push: auth === 'Bearer gho_alice' } }), { status: 200 });
		});

		const access = await memberPushAccess(redis, cloudProject());

		expect([...access]).toEqual([['alice', true], ['vera', false]]);
		expect(vi.mocked(query).mock.calls[0]![1]).toEqual(['proj-1']);
	});

	it('gives up on a member after the budget with null, and the late answer still fills the cache', async () => {
		vi.useFakeTimers();
		members([{ id: 'user-vera', slug: 'vera', access_token: VERA }]);
		let answer!: (response: Response) => void;
		vi.mocked(fetch).mockReturnValue(new Promise((resolve) => {
			answer = resolve;
		}));

		const pending = memberPushAccess(redis, cloudProject());
		await vi.advanceTimersByTimeAsync(PUSH_CHECK_BUDGET_MS);
		expect([...(await pending)]).toEqual([['vera', null]]);

		answer(new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 }));
		expect((await cachedFor('user-vera')).value).toBe('1');
	});

	it('is empty for a project without a cloud repository', async () => {
		const access = await memberPushAccess(redis, cloudProject({ storageMode: 'none', repository: {} }));

		expect(access.size).toBe(0);
		expect(query).not.toHaveBeenCalled();
	});
});

describe('connecting and disconnecting GitHub', () => {
	it('forgets only that user\'s answers', async () => {
		redis.store.set('github_push:v1:user-vera:aaaa:acme-corp/documentation', '0');
		redis.store.set('github_push:v1:user-vera:aaaa:acme-corp/website', '1');
		redis.store.set('github_push:v1:user-alice:bbbb:acme-corp/documentation', '1');

		await forgetPushAccess(redis, 'user-vera');

		expect([...redis.store.keys()]).toEqual(['github_push:v1:user-alice:bbbb:acme-corp/documentation']);
		expect(redis.scan).toHaveBeenCalled();
	});

	it('warms the cache for the user\'s cloud projects', async () => {
		vi.mocked(getProjects).mockResolvedValue([
			{ ...cloudProject(), itemCount: 0, itemCounts: { ready: 0, in_progress: 0, in_review: 0, done: 0 }, grantedRole: 'editor', effectiveRole: 'editor' },
			{ ...cloudProject({ id: 'proj-2', storageMode: 'none', repository: {} }), itemCount: 0, itemCounts: { ready: 0, in_progress: 0, in_review: 0, done: 0 }, grantedRole: 'owner', effectiveRole: 'owner' },
		]);
		githubAnswers(200, { permissions: { push: false } });

		await warmPushAccess(redis, 'user-vera');

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await callerPushAccess(redis, 'user-vera', VERA, cloudProject())).toBe(false);
	});
});
