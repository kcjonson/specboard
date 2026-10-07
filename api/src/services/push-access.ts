/**
 * Whether a member's GitHub account can push to their project's repository.
 *
 * Specboard doesn't enforce this; GitHub refuses the commit. It is surfaced early so a
 * member isn't surprised at commit time (docs/specs/multi-user-collaboration.md, Push
 * access). The answer is `permissions.push` from `GET /repos/{owner}/{repo}`, asked with
 * the member's own token, and it is three-valued: true, false, or null for "unknown or
 * not applicable" (no cloud repository, no GitHub connection, or GitHub didn't answer).
 *
 * GitHub is never allowed to hold up a response:
 * - Answers are cached in Redis per user and repository for PUSH_ACCESS_TTL_SECONDS. A
 *   collaborator change on GitHub is rare and the warning is advisory, so a few minutes
 *   of staleness is cheap; the same window the repo and branch lists already use.
 *   Connecting GitHub clears the user's answers, since the new token may be another
 *   GitHub account.
 * - A request waits at most PUSH_CHECK_BUDGET_MS for an uncached answer, then reports
 *   null. The check itself keeps going (up to PUSH_CHECK_TIMEOUT_MS) and fills the cache,
 *   so the next read has the answer. Concurrent reads of one user and repository share a
 *   single check.
 * - Failures (a revoked token, a rate limit, a timeout) are null and not cached.
 */

import type { Redis } from 'ioredis';
import { decrypt, type EncryptedData } from '@specboard/auth';
import { getProjects, isCloudRepository, query, type ProjectResponse } from '@specboard/db';
import { log } from '@specboard/core';
import { getEncryptedGitHubToken } from './github-token.ts';

export type PushAccess = boolean | null;

const GITHUB_API_URL = 'https://api.github.com';

export const PUSH_ACCESS_TTL_SECONDS = 300;
export const PUSH_CHECK_BUDGET_MS = 1000;
const PUSH_CHECK_TIMEOUT_MS = 5000;

/** How many projects a fresh GitHub connection pre-checks; the rest are checked when opened. */
const WARM_LIMIT = 20;

const CACHE_PREFIX = 'github_push:v1';

interface RepoAddress {
	owner: string;
	repo: string;
}

function repoOf(project: Pick<ProjectResponse, 'repository'>): RepoAddress | null {
	const { repository } = project;
	return isCloudRepository(repository) ? { owner: repository.remote.owner, repo: repository.remote.repo } : null;
}

// GitHub names are case-insensitive, so one repository is one key however it was typed.
function cacheKey(userId: string, repo: RepoAddress): string {
	return `${CACHE_PREFIX}:${userId}:${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
}

async function askGitHub(encryptedToken: string, repo: RepoAddress): Promise<PushAccess> {
	const token = decrypt(JSON.parse(encryptedToken) as EncryptedData);
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
			signal: AbortSignal.timeout(PUSH_CHECK_TIMEOUT_MS),
		}
	);
	// GitHub answers 404 for a private repository the token can't see: no access at all.
	if (response.status === 404) return false;
	if (!response.ok) return null;
	const body = (await response.json()) as { permissions?: { push?: unknown } } | null;
	const push = body?.permissions?.push;
	return typeof push === 'boolean' ? push : null;
}

const inFlight = new Map<string, Promise<PushAccess>>();

/** One check per key at a time. Never rejects; a failure is null and isn't cached. */
function startCheck(redis: Redis, key: string, encryptedToken: string, repo: RepoAddress): Promise<PushAccess> {
	const running = inFlight.get(key);
	if (running) return running;

	const check = askGitHub(encryptedToken, repo)
		.then(async (answer) => {
			if (answer !== null) {
				await redis.setex(key, PUSH_ACCESS_TTL_SECONDS, answer ? '1' : '0').catch(() => undefined);
			}
			return answer;
		})
		.catch((error: unknown) => {
			log({
				type: 'github',
				level: 'warn',
				event: 'github_push_access_check_failed',
				owner: repo.owner,
				repo: repo.repo,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, check);
	return check;
}

function withinBudget(check: Promise<PushAccess>): Promise<PushAccess> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), PUSH_CHECK_BUDGET_MS);
		void check.then((answer) => {
			clearTimeout(timer);
			resolve(answer);
		});
	});
}

async function cached(redis: Redis, key: string): Promise<PushAccess | undefined> {
	try {
		const value = await redis.get(key);
		if (value === '1') return true;
		if (value === '0') return false;
	} catch {
		// A Redis outage only costs the cache; ask GitHub.
	}
	return undefined;
}

async function pushAccess(redis: Redis, userId: string, encryptedToken: string | null, repo: RepoAddress | null): Promise<PushAccess> {
	if (!repo || !encryptedToken) return null;
	const key = cacheKey(userId, repo);
	const known = await cached(redis, key);
	if (known !== undefined) return known;
	return withinBudget(startCheck(redis, key, encryptedToken, repo));
}

/** The caller's push access to the project's repository. */
export async function callerPushAccess(redis: Redis, userId: string, project: ProjectResponse): Promise<PushAccess> {
	const repo = repoOf(project);
	if (!repo) return null;
	return pushAccess(redis, userId, await getEncryptedGitHubToken(userId), repo);
}

/**
 * Push access for everyone on the project (owner and members), each on their own stored
 * token, keyed by user slug. Anyone missing from the map has no GitHub connection, or
 * the project has no cloud repository; both read as null.
 */
export async function memberPushAccess(redis: Redis, project: ProjectResponse): Promise<Map<string, PushAccess>> {
	const repo = repoOf(project);
	if (!repo) return new Map();

	const result = await query<{ id: string; slug: string; access_token: string }>(
		`SELECT u.id, u.slug, gc.access_token
		 FROM (
			SELECT owner_id AS user_id FROM projects WHERE id = $1
			UNION ALL
			SELECT user_id FROM project_members WHERE project_id = $1
		 ) r
		 JOIN users u ON u.id = r.user_id
		 JOIN github_connections gc ON gc.user_id = u.id
		 WHERE u.slug IS NOT NULL`,
		[project.id]
	);
	const answers = await Promise.all(
		result.rows.map(async (row) => [row.slug, await pushAccess(redis, row.id, row.access_token, repo)] as const)
	);
	return new Map(answers);
}

/** Drop a user's cached answers. A new or removed connection makes them meaningless. */
export async function forgetPushAccess(redis: Redis, userId: string): Promise<void> {
	const keys = await redis.keys(`${CACHE_PREFIX}:${userId}:*`);
	if (keys.length > 0) await redis.del(...keys);
}

/**
 * Check the user's cloud projects right after they connect GitHub, so the page they
 * return to already has an answer. Callers don't wait on it.
 */
export async function warmPushAccess(redis: Redis, userId: string): Promise<void> {
	const token = await getEncryptedGitHubToken(userId);
	if (!token) return;
	const projects = (await getProjects(userId)).filter((project) => repoOf(project) !== null).slice(0, WARM_LIMIT);
	await Promise.all(
		projects.map((project) => {
			const repo = repoOf(project)!;
			return startCheck(redis, cacheKey(userId, repo), token, repo);
		})
	);
}
