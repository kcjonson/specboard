/**
 * Whether a member's GitHub account can push to their project's repository.
 *
 * Specboard doesn't enforce this; GitHub refuses the commit. It is surfaced early so a
 * member isn't surprised at commit time (docs/specs/multi-user-collaboration.md, Push
 * access). The answer is `permissions.push` from `GET /repos/{owner}/{repo}`, asked with
 * the member's own token, and it is three-valued: true, false, or null for "unknown or
 * not applicable" (no cloud repository, no GitHub connection, or GitHub didn't answer).
 *
 * GitHub is never allowed to hold up a project page:
 * - Answers are cached in Redis for PUSH_ACCESS_TTL_SECONDS. A collaborator change on
 *   GitHub is rare and the warning is advisory, so a few minutes of staleness is cheap;
 *   the same window the repo and branch lists already use. Failures (a revoked token, a
 *   rate limit, an outage, a timeout) are cached as unknown for PUSH_FAILURE_TTL_SECONDS,
 *   so a broken token isn't re-asked on every page load.
 * - The caller's own answer (the project GET) comes from the cache or is null, and a
 *   miss starts the check in the background for the next page view.
 * - The owner's member list waits at most PUSH_CHECK_BUDGET_MS per member for a miss,
 *   then reports null while the check finishes and fills the cache.
 * - Keys carry a fingerprint of the stored (encrypted) token, so an answer earned by
 *   one GitHub connection is never read, or joined in flight, by the next one.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { decrypt, type EncryptedData } from '@specboard/auth';
import { getProjects, isCloudRepository, query, type ProjectResponse } from '@specboard/db';
import { log } from '@specboard/core';
import { getGitHubConnection } from './github-token.ts';
import { deleteKeysMatching } from './redis-keys.ts';

export type PushAccess = boolean | null;

const GITHUB_API_URL = 'https://api.github.com';

export const PUSH_ACCESS_TTL_SECONDS = 300;
export const PUSH_FAILURE_TTL_SECONDS = 60;
export const PUSH_CHECK_BUDGET_MS = 1000;
const PUSH_CHECK_TIMEOUT_MS = 5000;

/** How many projects a fresh GitHub connection pre-checks; the rest are checked when opened. */
const WARM_LIMIT = 20;

const CACHE_PREFIX = 'github_push:v1';

/** Cached values: '1' can push, '0' can't, '?' GitHub didn't say. */
const CACHED: Record<string, PushAccess> = { '1': true, '0': false, '?': null };

interface RepoAddress {
	owner: string;
	repo: string;
}

function repoOf(project: Pick<ProjectResponse, 'repository'>): RepoAddress | null {
	const { repository } = project;
	return isCloudRepository(repository) ? { owner: repository.remote.owner, repo: repository.remote.repo } : null;
}

// GitHub names are case-insensitive, so one repository is one key however it was typed.
// The fingerprint is of the encrypted token (fresh IV per connection), never the token.
function cacheKey(userId: string, encryptedToken: string, repo: RepoAddress): string {
	const fingerprint = createHash('sha256').update(encryptedToken).digest('hex').slice(0, 16);
	return `${CACHE_PREFIX}:${userId}:${fingerprint}:${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
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

/** One check per key at a time. Never rejects. */
function startCheck(redis: Redis, key: string, encryptedToken: string, repo: RepoAddress): Promise<PushAccess> {
	const running = inFlight.get(key);
	if (running) return running;

	const check = askGitHub(encryptedToken, repo)
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
		.then(async (answer) => {
			const [value, ttl] = answer === null ? ['?', PUSH_FAILURE_TTL_SECONDS] : [answer ? '1' : '0', PUSH_ACCESS_TTL_SECONDS];
			await redis.setex(key, ttl, value).catch(() => undefined);
			return answer;
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

/** The cached answer, or undefined on a miss (or a Redis outage, which only costs the cache). */
async function cached(redis: Redis, key: string): Promise<PushAccess | undefined> {
	try {
		const value = await redis.get(key);
		return value !== null && value in CACHED ? CACHED[value] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The caller's push access to the project's repository, for the project GET: whatever
 * the cache holds, else null at once with the check started for the next page view.
 */
export async function callerPushAccess(
	redis: Redis,
	userId: string,
	encryptedToken: string | null,
	project: ProjectResponse
): Promise<PushAccess> {
	const repo = repoOf(project);
	if (!repo || !encryptedToken) return null;
	const key = cacheKey(userId, encryptedToken, repo);
	const known = await cached(redis, key);
	if (known !== undefined) return known;
	void startCheck(redis, key, encryptedToken, repo);
	return null;
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
		result.rows.map(async (row) => {
			const key = cacheKey(row.id, row.access_token, repo);
			const known = await cached(redis, key);
			const answer = known !== undefined ? known : await withinBudget(startCheck(redis, key, row.access_token, repo));
			return [row.slug, answer] as const;
		})
	);
	return new Map(answers);
}

/** Drop a user's cached answers. A new or removed connection makes them meaningless. */
export async function forgetPushAccess(redis: Redis, userId: string): Promise<void> {
	await deleteKeysMatching(redis, `${CACHE_PREFIX}:${userId}:*`);
}

/**
 * Check the user's cloud projects right after they connect GitHub, so the page they
 * return to already has an answer. Callers don't wait on it.
 */
export async function warmPushAccess(redis: Redis, userId: string): Promise<void> {
	const connection = await getGitHubConnection(userId);
	if (!connection) return;
	const projects = (await getProjects(userId)).filter((project) => repoOf(project) !== null).slice(0, WARM_LIMIT);
	await Promise.all(
		projects.map((project) => {
			const repo = repoOf(project)!;
			return startCheck(redis, cacheKey(userId, connection.encryptedToken, repo), connection.encryptedToken, repo);
		})
	);
}
