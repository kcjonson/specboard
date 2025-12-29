/**
 * MCP OAuth 2.1 + PKCE handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';

// Constants
const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const AUTH_CODE_TTL_SECONDS = 600; // 10 minutes

// Allowed clients (in production, this could be a database table)
const ALLOWED_CLIENTS = new Set(['claude-code', 'doc-platform-cli']);

// Valid scopes
const VALID_SCOPES = new Set(['docs:read', 'docs:write', 'tasks:read', 'tasks:write']);

// Scope descriptions for consent screen
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
	'docs:read': 'Read your documents',
	'docs:write': 'Create and modify documents',
	'tasks:read': 'Read your tasks and epics',
	'tasks:write': 'Create and update tasks',
};

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Validate PKCE code_challenge against code_verifier
 */
function validatePkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
	if (method !== 'S256') {
		return false;
	}
	const hash = createHash('sha256').update(codeVerifier).digest('base64url');
	return hash === codeChallenge;
}

/**
 * Parse scopes from space-separated string
 */
function parseScopes(scopeString: string): string[] {
	return scopeString.split(/\s+/).filter(s => s && VALID_SCOPES.has(s));
}

/**
 * OAuth 2.0 Authorization Server Metadata
 * GET /.well-known/oauth-authorization-server
 */
export async function handleOAuthMetadata(context: Context): Promise<Response> {
	const baseUrl = getBaseUrl(context);

	return context.json({
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/oauth/authorize`,
		token_endpoint: `${baseUrl}/oauth/token`,
		revocation_endpoint: `${baseUrl}/oauth/revoke`,
		scopes_supported: Array.from(VALID_SCOPES),
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'], // Public client
	});
}

/**
 * Get base URL from request
 */
function getBaseUrl(context: Context): string {
	const proto = context.req.header('x-forwarded-proto') || 'http';
	const host = context.req.header('host') || 'localhost';
	return `${proto}://${host}`;
}

/**
 * Authorization endpoint - GET shows consent, POST processes it
 * GET /oauth/authorize
 */
export async function handleAuthorizeGet(
	context: Context,
	redis: Redis
): Promise<Response> {
	// Validate session
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		// Redirect to login with return URL
		const returnUrl = encodeURIComponent(context.req.url);
		return context.redirect(`/login?next=${returnUrl}`);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		const returnUrl = encodeURIComponent(context.req.url);
		return context.redirect(`/login?next=${returnUrl}`);
	}

	// Parse query parameters
	const url = new URL(context.req.url);
	const clientId = url.searchParams.get('client_id');
	const redirectUri = url.searchParams.get('redirect_uri');
	const responseType = url.searchParams.get('response_type');
	const scope = url.searchParams.get('scope') || '';
	const state = url.searchParams.get('state') || '';
	const codeChallenge = url.searchParams.get('code_challenge');
	const codeChallengeMethod = url.searchParams.get('code_challenge_method');

	// Validate required parameters
	if (!clientId || !ALLOWED_CLIENTS.has(clientId)) {
		return context.json({ error: 'invalid_client', error_description: 'Unknown client' }, 400);
	}

	if (responseType !== 'code') {
		return context.json({ error: 'unsupported_response_type' }, 400);
	}

	if (!redirectUri) {
		return context.json({ error: 'invalid_request', error_description: 'redirect_uri required' }, 400);
	}

	// Validate redirect_uri (must be localhost for public clients)
	try {
		const redirectUrl = new URL(redirectUri);
		if (!['127.0.0.1', 'localhost'].includes(redirectUrl.hostname)) {
			return context.json({ error: 'invalid_request', error_description: 'redirect_uri must be localhost' }, 400);
		}
	} catch {
		return context.json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' }, 400);
	}

	if (!codeChallenge || codeChallengeMethod !== 'S256') {
		return context.json({ error: 'invalid_request', error_description: 'PKCE required (code_challenge with S256)' }, 400);
	}

	// Parse and validate scopes
	const scopes = parseScopes(scope);
	if (scopes.length === 0) {
		return context.json({ error: 'invalid_scope', error_description: 'At least one valid scope required' }, 400);
	}

	// Get user info for consent screen
	const userResult = await query<User>(
		'SELECT * FROM users WHERE id = $1',
		[session.userId]
	);
	const user = userResult.rows[0];
	if (!user) {
		return context.json({ error: 'server_error' }, 500);
	}

	// Return consent page data (frontend will render)
	// For server-rendered page, redirect to frontend consent route
	const consentParams = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: scopes.join(' '),
		state,
		code_challenge: codeChallenge,
		code_challenge_method: codeChallengeMethod,
	});

	return context.redirect(`/oauth/consent?${consentParams.toString()}`);
}

/**
 * Process consent form submission
 * POST /oauth/authorize
 */
export async function handleAuthorizePost(
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

	// Parse form body
	let body: {
		client_id: string;
		redirect_uri: string;
		scope: string;
		state: string;
		code_challenge: string;
		code_challenge_method: string;
		device_name: string;
		action: 'approve' | 'deny';
	};

	const contentType = context.req.header('content-type') || '';
	if (contentType.includes('application/json')) {
		body = await context.req.json();
	} else {
		// Handle form-urlencoded
		const formData = await context.req.parseBody();
		body = {
			client_id: String(formData.client_id || ''),
			redirect_uri: String(formData.redirect_uri || ''),
			scope: String(formData.scope || ''),
			state: String(formData.state || ''),
			code_challenge: String(formData.code_challenge || ''),
			code_challenge_method: String(formData.code_challenge_method || ''),
			device_name: String(formData.device_name || ''),
			action: formData.action as 'approve' | 'deny',
		};
	}

	const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, device_name, action } = body;

	// Build redirect URL
	const redirectUrl = new URL(redirect_uri);

	// If denied, redirect with error
	if (action === 'deny') {
		redirectUrl.searchParams.set('error', 'access_denied');
		if (state) redirectUrl.searchParams.set('state', state);
		return context.redirect(redirectUrl.toString());
	}

	// Validate inputs
	if (!client_id || !ALLOWED_CLIENTS.has(client_id)) {
		return context.json({ error: 'invalid_client' }, 400);
	}

	if (!device_name || device_name.trim().length === 0) {
		return context.json({ error: 'invalid_request', error_description: 'Device name required' }, 400);
	}

	if (device_name.length > 255) {
		return context.json({ error: 'invalid_request', error_description: 'Device name too long' }, 400);
	}

	if (!code_challenge || code_challenge_method !== 'S256') {
		return context.json({ error: 'invalid_request', error_description: 'PKCE required' }, 400);
	}

	const scopes = parseScopes(scope);
	if (scopes.length === 0) {
		return context.json({ error: 'invalid_scope' }, 400);
	}

	// Generate authorization code
	const code = generateToken();
	const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);

	// Store authorization code
	await query(
		`INSERT INTO oauth_codes (code, user_id, client_id, device_name, code_challenge, code_challenge_method, scopes, redirect_uri, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[code, session.userId, client_id, device_name.trim(), code_challenge, code_challenge_method, scopes, redirect_uri, expiresAt]
	);

	// Redirect with code
	redirectUrl.searchParams.set('code', code);
	if (state) redirectUrl.searchParams.set('state', state);

	return context.redirect(redirectUrl.toString());
}

/**
 * Token endpoint - exchange code for tokens or refresh
 * POST /oauth/token
 */
export async function handleToken(context: Context): Promise<Response> {
	// Parse body (form-urlencoded per OAuth spec)
	const contentType = context.req.header('content-type') || '';
	let body: Record<string, string>;

	if (contentType.includes('application/json')) {
		body = await context.req.json();
	} else {
		const formData = await context.req.parseBody();
		body = {};
		for (const [key, value] of Object.entries(formData)) {
			body[key] = String(value);
		}
	}

	const grantType = body.grant_type;

	if (grantType === 'authorization_code') {
		return handleAuthorizationCodeGrant(context, body);
	} else if (grantType === 'refresh_token') {
		return handleRefreshTokenGrant(context, body);
	} else {
		return context.json({ error: 'unsupported_grant_type' }, 400);
	}
}

/**
 * Handle authorization_code grant
 */
async function handleAuthorizationCodeGrant(
	context: Context,
	body: Record<string, string>
): Promise<Response> {
	const { code, code_verifier, redirect_uri } = body;

	if (!code || !code_verifier) {
		return context.json({ error: 'invalid_request', error_description: 'code and code_verifier required' }, 400);
	}

	// Look up authorization code
	const codeResult = await query<{
		code: string;
		user_id: string;
		client_id: string;
		device_name: string;
		code_challenge: string;
		code_challenge_method: string;
		scopes: string[];
		redirect_uri: string;
		expires_at: Date;
	}>('SELECT * FROM oauth_codes WHERE code = $1', [code]);

	const authCode = codeResult.rows[0];
	if (!authCode) {
		return context.json({ error: 'invalid_grant', error_description: 'Invalid or expired code' }, 400);
	}

	// Check expiration
	if (new Date(authCode.expires_at) < new Date()) {
		await query('DELETE FROM oauth_codes WHERE code = $1', [code]);
		return context.json({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
	}

	// Validate redirect_uri matches
	if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
		return context.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
	}

	// Validate PKCE
	if (!validatePkce(code_verifier, authCode.code_challenge, authCode.code_challenge_method)) {
		return context.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
	}

	// Delete the used code
	await query('DELETE FROM oauth_codes WHERE code = $1', [code]);

	// Generate tokens
	const accessToken = generateToken();
	const refreshToken = generateToken();
	const accessTokenHash = hashToken(accessToken);
	const refreshTokenHash = hashToken(refreshToken);
	const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

	// Store tokens
	await query(
		`INSERT INTO mcp_tokens (user_id, client_id, device_name, access_token_hash, refresh_token_hash, scopes, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[authCode.user_id, authCode.client_id, authCode.device_name, accessTokenHash, refreshTokenHash, authCode.scopes, refreshExpiresAt]
	);

	return context.json({
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		refresh_token: refreshToken,
		scope: authCode.scopes.join(' '),
	});
}

/**
 * Handle refresh_token grant
 */
async function handleRefreshTokenGrant(
	context: Context,
	body: Record<string, string>
): Promise<Response> {
	const { refresh_token } = body;

	if (!refresh_token) {
		return context.json({ error: 'invalid_request', error_description: 'refresh_token required' }, 400);
	}

	const refreshTokenHash = hashToken(refresh_token);

	// Look up token
	const tokenResult = await query<{
		id: string;
		user_id: string;
		client_id: string;
		device_name: string;
		scopes: string[];
		expires_at: Date;
	}>('SELECT * FROM mcp_tokens WHERE refresh_token_hash = $1', [refreshTokenHash]);

	const token = tokenResult.rows[0];
	if (!token) {
		return context.json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
	}

	// Check if refresh token expired
	if (new Date(token.expires_at) < new Date()) {
		await query('DELETE FROM mcp_tokens WHERE id = $1', [token.id]);
		return context.json({ error: 'invalid_grant', error_description: 'Refresh token expired' }, 400);
	}

	// Generate new tokens
	const newAccessToken = generateToken();
	const newRefreshToken = generateToken();
	const newAccessTokenHash = hashToken(newAccessToken);
	const newRefreshTokenHash = hashToken(newRefreshToken);
	const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

	// Update token record
	await query(
		`UPDATE mcp_tokens SET access_token_hash = $1, refresh_token_hash = $2, expires_at = $3 WHERE id = $4`,
		[newAccessTokenHash, newRefreshTokenHash, newExpiresAt, token.id]
	);

	return context.json({
		access_token: newAccessToken,
		token_type: 'Bearer',
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		refresh_token: newRefreshToken,
		scope: token.scopes.join(' '),
	});
}

/**
 * Revoke a token
 * POST /oauth/revoke
 */
export async function handleRevoke(context: Context): Promise<Response> {
	const contentType = context.req.header('content-type') || '';
	let body: { token?: string; token_type_hint?: string };

	if (contentType.includes('application/json')) {
		body = await context.req.json();
	} else {
		const formData = await context.req.parseBody();
		body = {
			token: String(formData.token || ''),
			token_type_hint: String(formData.token_type_hint || ''),
		};
	}

	const { token } = body;
	if (!token) {
		return context.json({ error: 'invalid_request' }, 400);
	}

	const tokenHash = hashToken(token);

	// Try to delete by access_token_hash or refresh_token_hash
	await query('DELETE FROM mcp_tokens WHERE access_token_hash = $1 OR refresh_token_hash = $1', [tokenHash]);

	// Always return 200 per RFC 7009
	return context.json({});
}

/**
 * List user's authorized apps
 * GET /api/oauth/authorizations
 */
export async function handleListAuthorizations(
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
		client_id: string;
		device_name: string;
		scopes: string[];
		created_at: Date;
		last_used_at: Date | null;
	}>(
		`SELECT id, client_id, device_name, scopes, created_at, last_used_at
		 FROM mcp_tokens
		 WHERE user_id = $1
		 ORDER BY created_at DESC`,
		[session.userId]
	);

	return context.json({
		authorizations: result.rows.map(row => ({
			id: row.id,
			client_id: row.client_id,
			device_name: row.device_name,
			scopes: row.scopes,
			created_at: row.created_at,
			last_used_at: row.last_used_at,
		})),
	});
}

/**
 * Revoke a specific authorization
 * DELETE /api/oauth/authorizations/:id
 */
export async function handleDeleteAuthorization(
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

	const id = context.req.param('id');

	// Delete only if owned by user
	const result = await query(
		'DELETE FROM mcp_tokens WHERE id = $1 AND user_id = $2',
		[id, session.userId]
	);

	if (result.rowCount === 0) {
		return context.json({ error: 'not_found' }, 404);
	}

	return new Response(null, { status: 204 });
}
