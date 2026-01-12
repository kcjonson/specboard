/**
 * GitHub OAuth and API handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { getSession, SESSION_COOKIE_NAME, encrypt, decrypt, type EncryptedData } from '@doc-platform/auth';
import { query } from '@doc-platform/db';
import { log } from '@doc-platform/core';

// GitHub OAuth configuration
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

// Required scopes for repository access
const GITHUB_SCOPES = ['repo', 'user:email'];

// State token TTL in Redis (10 minutes)
const STATE_TTL_SECONDS = 600;

// Cache TTL constants
const REPOS_CACHE_TTL_SECONDS = 300;
const BRANCHES_CACHE_TTL_SECONDS = 300;

// GitHub naming validation (alphanumeric, hyphens, underscores, dots)
const GITHUB_NAME_REGEX = /^[a-zA-Z0-9._-]{1,100}$/;

/**
 * Generate a secure random state token
 */
function generateState(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Get base URL from environment or request
 * Uses APP_URL env var to prevent host header injection attacks
 */
function getBaseUrl(): string {
	const appUrl = process.env.APP_URL;
	if (appUrl) {
		return appUrl.replace(/\/$/, ''); // Remove trailing slash
	}
	// Fallback for local dev only
	return 'http://localhost';
}

/**
 * Start GitHub OAuth flow
 * GET /api/auth/github
 */
export async function handleGitHubAuthStart(
	context: Context,
	redis: Redis
): Promise<Response> {
	// Validate session
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	// Check for client ID configuration
	const clientId = process.env.GITHUB_CLIENT_ID;
	if (!clientId) {
		return context.json({ error: 'GitHub OAuth not configured' }, 500);
	}

	// Generate and store state token
	const state = generateState();
	await redis.setex(`github_oauth_state:${state}`, STATE_TTL_SECONDS, session.userId);

	// Build authorization URL
	const baseUrl = getBaseUrl();
	const redirectUri = `${baseUrl}/api/auth/github/callback`;

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: GITHUB_SCOPES.join(' '),
		state,
	});

	const authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;

	return context.redirect(authorizeUrl);
}

/**
 * Handle GitHub OAuth callback
 * GET /api/auth/github/callback
 */
export async function handleGitHubAuthCallback(
	context: Context,
	redis: Redis
): Promise<Response> {
	const url = new URL(context.req.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	// Handle GitHub error
	if (error) {
		const errorDescription = url.searchParams.get('error_description') || 'Authorization failed';
		return context.redirect(`/settings?github_error=${encodeURIComponent(errorDescription)}`);
	}

	// Validate code and state
	if (!code || !state) {
		return context.redirect('/settings?github_error=Invalid+callback+parameters');
	}

	// Verify state and get user ID
	const userId = await redis.get(`github_oauth_state:${state}`);
	if (!userId) {
		return context.redirect('/settings?github_error=Invalid+or+expired+state');
	}

	// Delete used state
	await redis.del(`github_oauth_state:${state}`);

	// Exchange code for access token
	const clientId = process.env.GITHUB_CLIENT_ID;
	const clientSecret = process.env.GITHUB_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return context.redirect('/settings?github_error=GitHub+OAuth+not+configured');
	}

	const baseUrl = getBaseUrl();
	const redirectUri = `${baseUrl}/api/auth/github/callback`;

	let accessToken: string;
	let tokenType: string;
	let scope: string;

	try {
		const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			throw new Error('Token exchange failed');
		}

		const tokenData = await tokenResponse.json() as {
			access_token?: string;
			token_type?: string;
			scope?: string;
			error?: string;
			error_description?: string;
		};

		if (tokenData.error) {
			throw new Error(tokenData.error_description || tokenData.error);
		}

		if (!tokenData.access_token) {
			throw new Error('No access token received');
		}

		accessToken = tokenData.access_token;
		tokenType = tokenData.token_type || 'bearer';
		scope = tokenData.scope || '';
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Token exchange failed';
		return context.redirect(`/settings?github_error=${encodeURIComponent(message)}`);
	}

	// Get GitHub user info
	let githubUserId: string;
	let githubUsername: string;

	try {
		const userResponse = await fetch(`${GITHUB_API_URL}/user`, {
			headers: {
				'Accept': 'application/vnd.github+json',
				'Authorization': `${tokenType} ${accessToken}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});

		if (!userResponse.ok) {
			throw new Error('Failed to fetch GitHub user');
		}

		const userData = await userResponse.json() as {
			id: number;
			login: string;
		};

		githubUserId = String(userData.id);
		githubUsername = userData.login;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to fetch user info';
		return context.redirect(`/settings?github_error=${encodeURIComponent(message)}`);
	}

	// Encrypt and store token
	const encryptedToken = encrypt(accessToken);
	// GitHub returns scopes as space-separated, handle both formats for safety
	const scopes = scope.split(/[\s,]+/).filter(Boolean);

	try {
		// Upsert connection (user can only have one GitHub connection)
		await query(
			`INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes, connected_at)
			 VALUES ($1, $2, $3, $4, $5, NOW())
			 ON CONFLICT (user_id)
			 DO UPDATE SET
				github_user_id = EXCLUDED.github_user_id,
				github_username = EXCLUDED.github_username,
				access_token = EXCLUDED.access_token,
				scopes = EXCLUDED.scopes,
				connected_at = NOW()`,
			[
				userId,
				githubUserId,
				githubUsername,
				JSON.stringify(encryptedToken),
				scopes,
			]
		);
	} catch (err) {
		log({
			type: 'auth',
			level: 'error',
			event: 'github_connect_failed',
			userId,
			reason: 'database_error',
			error: err instanceof Error ? err.message : String(err),
		});
		return context.redirect('/settings?github_error=Failed+to+save+connection');
	}

	// Log successful connection
	log({
		type: 'auth',
		level: 'info',
		event: 'github_connect',
		userId,
		githubUsername,
	});

	// Redirect to settings with success
	return context.redirect('/settings?github_connected=true');
}

/**
 * Get current user's GitHub connection status
 * GET /api/github/connection
 */
export async function handleGetGitHubConnection(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const result = await query<{
		id: string;
		github_username: string;
		scopes: string[];
		connected_at: Date;
	}>(
		`SELECT id, github_username, scopes, connected_at
		 FROM github_connections
		 WHERE user_id = $1`,
		[session.userId]
	);

	if (result.rows.length === 0) {
		return context.json({ connected: false });
	}

	const connection = result.rows[0]!;
	return context.json({
		connected: true,
		username: connection.github_username,
		scopes: connection.scopes,
		connectedAt: connection.connected_at,
	});
}

/**
 * Disconnect GitHub account
 * DELETE /api/auth/github
 */
export async function handleGitHubDisconnect(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	await query(
		'DELETE FROM github_connections WHERE user_id = $1',
		[session.userId]
	);

	log({
		type: 'auth',
		level: 'info',
		event: 'github_disconnect',
		userId: session.userId,
	});

	return new Response(null, { status: 204 });
}

/**
 * List user's GitHub repositories
 * GET /api/github/repos
 */
export async function handleListGitHubRepos(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	// Get user's GitHub connection
	const connectionResult = await query<{
		access_token: string;
	}>(
		'SELECT access_token FROM github_connections WHERE user_id = $1',
		[session.userId]
	);

	// Return empty array if not connected (not an error - just no repos available)
	if (connectionResult.rows.length === 0) {
		return context.json([]);
	}

	// Decrypt access token
	let accessToken: string;
	try {
		const encryptedToken: EncryptedData = JSON.parse(connectionResult.rows[0]!.access_token);
		accessToken = decrypt(encryptedToken);
	} catch (err) {
		log({
			type: 'auth',
			level: 'error',
			event: 'github_token_decrypt_failed',
			userId: session.userId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'GitHub connection corrupted. Please reconnect.' }, 500);
	}

	// Check Redis cache first
	const cacheKey = `github_repos:${session.userId}`;
	const cached = await redis.get(cacheKey);
	if (cached) {
		try {
			return context.json(JSON.parse(cached));
		} catch {
			// Cache corrupted, delete and continue
			await redis.del(cacheKey);
		}
	}

	// Fetch repos from GitHub (with pagination)
	const repos: Array<{
		id: number;
		full_name: string;
		name: string;
		owner: { login: string };
		private: boolean;
		default_branch: string;
		html_url: string;
	}> = [];

	let page = 1;
	const perPage = 100;

	try {
		while (true) {
			const response = await fetch(
				`${GITHUB_API_URL}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator`,
				{
					headers: {
						'Accept': 'application/vnd.github+json',
						'Authorization': `Bearer ${accessToken}`,
						'X-GitHub-Api-Version': '2022-11-28',
					},
				}
			);

			if (!response.ok) {
				if (response.status === 401) {
					return context.json({ error: 'GitHub authorization expired. Please reconnect.' }, 401);
				}
				if (response.status === 403) {
					const remaining = response.headers.get('X-RateLimit-Remaining');
					if (remaining === '0') {
						return context.json({ error: 'GitHub rate limit exceeded. Please try again later.' }, 429);
					}
					return context.json({ error: 'Insufficient permissions for GitHub' }, 403);
				}
				throw new Error('Failed to fetch repositories');
			}

			const pageRepos = await response.json() as typeof repos;
			repos.push(...pageRepos);

			// Check if there are more pages
			if (pageRepos.length < perPage) {
				break;
			}

			page++;

			// Safety limit
			if (page > 10) {
				break;
			}
		}
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_api_error',
			userId: session.userId,
			endpoint: 'repos',
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'Failed to fetch repositories' }, 500);
	}

	// Format response
	const formattedRepos = repos.map(repo => ({
		id: repo.id,
		fullName: repo.full_name,
		name: repo.name,
		owner: repo.owner.login,
		private: repo.private,
		defaultBranch: repo.default_branch,
		url: repo.html_url,
	}));

	// Cache for 5 minutes
	await redis.setex(cacheKey, REPOS_CACHE_TTL_SECONDS, JSON.stringify(formattedRepos));

	return context.json(formattedRepos);
}

/**
 * List branches for a GitHub repository
 * GET /api/github/repos/:owner/:repo/branches
 */
export async function handleListGitHubBranches(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const owner = context.req.param('owner');
	const repo = context.req.param('repo');

	if (!owner || !repo) {
		return context.json({ error: 'owner and repo required' }, 400);
	}

	// Validate owner/repo format to prevent malformed API requests
	if (!GITHUB_NAME_REGEX.test(owner) || !GITHUB_NAME_REGEX.test(repo)) {
		return context.json({ error: 'Invalid owner or repo format' }, 400);
	}

	// Get user's GitHub connection
	const connectionResult = await query<{
		access_token: string;
	}>(
		'SELECT access_token FROM github_connections WHERE user_id = $1',
		[session.userId]
	);

	if (connectionResult.rows.length === 0) {
		return context.json({ error: 'GitHub not connected' }, 400);
	}

	// Decrypt access token
	let accessToken: string;
	try {
		const encryptedToken: EncryptedData = JSON.parse(connectionResult.rows[0]!.access_token);
		accessToken = decrypt(encryptedToken);
	} catch (err) {
		log({
			type: 'auth',
			level: 'error',
			event: 'github_token_decrypt_failed',
			userId: session.userId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'GitHub connection corrupted. Please reconnect.' }, 500);
	}

	// Check Redis cache first (include user ID to prevent cross-user cache sharing)
	const cacheKey = `github_branches:${session.userId}:${owner}:${repo}`;
	const cached = await redis.get(cacheKey);
	if (cached) {
		try {
			return context.json(JSON.parse(cached));
		} catch {
			// Cache corrupted, delete and continue
			await redis.del(cacheKey);
		}
	}

	// Fetch branches from GitHub
	try {
		const response = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
			{
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${accessToken}`,
					'X-GitHub-Api-Version': '2022-11-28',
				},
			}
		);

		if (!response.ok) {
			if (response.status === 404) {
				return context.json({ error: 'Repository not found' }, 404);
			}
			if (response.status === 401) {
				return context.json({ error: 'GitHub authorization expired. Please reconnect.' }, 401);
			}
			if (response.status === 403) {
				const remaining = response.headers.get('X-RateLimit-Remaining');
				if (remaining === '0') {
					return context.json({ error: 'GitHub rate limit exceeded. Please try again later.' }, 429);
				}
				return context.json({ error: 'Insufficient permissions for this repository' }, 403);
			}
			throw new Error('Failed to fetch branches');
		}

		const branches = await response.json() as Array<{
			name: string;
			protected: boolean;
		}>;

		const formattedBranches = branches.map(b => ({
			name: b.name,
			protected: b.protected,
		}));

		// Cache for 5 minutes
		await redis.setex(cacheKey, BRANCHES_CACHE_TTL_SECONDS, JSON.stringify(formattedBranches));

		return context.json(formattedBranches);
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_api_error',
			userId: session.userId,
			endpoint: 'branches',
			owner,
			repo,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'Failed to fetch branches' }, 500);
	}
}
