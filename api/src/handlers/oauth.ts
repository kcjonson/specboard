/**
 * MCP OAuth 2.1 + PKCE handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import { query, transaction, type User } from '@specboard/db';

// Constants
const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const AUTH_CODE_TTL_SECONDS = 600; // 10 minutes

// Valid scopes
const VALID_SCOPES = new Set(['docs:read', 'docs:write', 'tasks:read', 'tasks:write']);

/**
 * OAuth client stored in database
 */
interface OAuthClient {
	client_id: string;
	client_name: string | null;
	redirect_uris: string[];
	token_endpoint_auth_method: string;
	grant_types: string[];
	response_types: string[];
	client_id_issued_at: Date;
	created_at: Date;
}

/**
 * Validate a redirect URI for client registration
 * Only allows localhost (http) or HTTPS URLs
 */
function isValidRedirectUriForRegistration(redirectUri: string): boolean {
	try {
		const url = new URL(redirectUri);
		// Allow localhost with http (for local CLI tools)
		const isLocalhost = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:';
		// Require HTTPS for non-localhost
		const isSecure = url.protocol === 'https:';
		return isLocalhost || isSecure;
	} catch {
		return false;
	}
}

/**
 * Check if a redirect URI matches one of the client's registered URIs
 */
function isRedirectUriAllowedForClient(redirectUri: string, client: OAuthClient): boolean {
	return client.redirect_uris.includes(redirectUri);
}

/**
 * Look up a client by ID from the database
 */
async function getClient(clientId: string): Promise<OAuthClient | null> {
	const result = await query<OAuthClient>(
		'SELECT * FROM oauth_clients WHERE client_id = $1',
		[clientId]
	);
	return result.rows[0] || null;
}

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
 * Sanitize a string for safe display (prevents XSS)
 * Removes control characters and escapes HTML entities
 */
function sanitizeForDisplay(input: string): string {
	// Remove control characters (except space \x20, tab \x09, newline \x0A, carriage return \x0D)
	// Using character code filtering to avoid eslint no-control-regex issues
	const filtered = Array.from(input)
		.filter(char => {
			const code = char.charCodeAt(0);
			// Allow printable ASCII (space and above) plus tab, newline, carriage return
			return code >= 0x20 || code === 0x09 || code === 0x0A || code === 0x0D;
		})
		.join('');

	// Escape HTML entities
	return filtered
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
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
		registration_endpoint: `${baseUrl}/oauth/register`,
		scopes_supported: Array.from(VALID_SCOPES),
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'], // Public client
	});
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * GET /.well-known/oauth-protected-resource
 *
 * Tells MCP clients which authorization server to use for this resource.
 */
export async function handleProtectedResourceMetadata(context: Context): Promise<Response> {
	const baseUrl = getBaseUrl(context);

	return context.json({
		resource: `${baseUrl}/mcp`,
		authorization_servers: [baseUrl],
		scopes_supported: Array.from(VALID_SCOPES),
	});
}

/**
 * RFC 7591 Dynamic Client Registration
 * POST /oauth/register
 *
 * Allows OAuth clients to register themselves dynamically.
 * This is required for tools like Claude Code that need to authenticate
 * with arbitrary OAuth servers without pre-registration.
 */
export async function handleClientRegistration(context: Context): Promise<Response> {
	// Parse request body
	let body: {
		client_name?: string;
		redirect_uris?: string[];
		token_endpoint_auth_method?: string;
		grant_types?: string[];
		response_types?: string[];
	};

	try {
		body = await context.req.json();
	} catch {
		return context.json({
			error: 'invalid_request',
			error_description: 'Invalid JSON body',
		}, 400);
	}

	// Validate client_name type, length, and non-empty
	let clientName: string | null = null;
	if (body.client_name !== undefined) {
		if (typeof body.client_name !== 'string') {
			return context.json({
				error: 'invalid_client_metadata',
				error_description: 'client_name must be a string',
			}, 400);
		}
		const trimmedClientName = body.client_name.trim();
		if (trimmedClientName.length === 0) {
			return context.json({
				error: 'invalid_client_metadata',
				error_description: 'client_name must not be empty or whitespace',
			}, 400);
		}
		if (trimmedClientName.length > 255) {
			return context.json({
				error: 'invalid_client_metadata',
				error_description: 'client_name too long (max 255 characters)',
			}, 400);
		}
		clientName = trimmedClientName;
	}

	// Validate redirect_uris (required)
	if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
		return context.json({
			error: 'invalid_redirect_uri',
			error_description: 'At least one redirect_uri is required',
		}, 400);
	}

	// Limit number of redirect URIs to prevent abuse
	if (body.redirect_uris.length > 20) {
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'Too many redirect_uris (max 20)',
		}, 400);
	}

	// Validate each redirect URI
	for (const uri of body.redirect_uris) {
		if (typeof uri !== 'string' || !isValidRedirectUriForRegistration(uri)) {
			return context.json({
				error: 'invalid_redirect_uri',
				error_description: 'One or more redirect_uri values are invalid. Must be localhost (http) or HTTPS URLs.',
			}, 400);
		}
	}

	// Deduplicate redirect URIs
	const uniqueRedirectUris = [...new Set(body.redirect_uris)];

	// Validate token_endpoint_auth_method type
	if (body.token_endpoint_auth_method !== undefined && typeof body.token_endpoint_auth_method !== 'string') {
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'token_endpoint_auth_method must be a string',
		}, 400);
	}
	const tokenEndpointAuthMethod = body.token_endpoint_auth_method || 'none';
	if (tokenEndpointAuthMethod !== 'none') {
		// We only support public clients with PKCE
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'Only token_endpoint_auth_method "none" is supported (public client with PKCE)',
		}, 400);
	}

	// Validate grant_types type
	if (body.grant_types !== undefined && !Array.isArray(body.grant_types)) {
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'grant_types must be an array',
		}, 400);
	}
	const grantTypes = body.grant_types || ['authorization_code', 'refresh_token'];

	// Validate response_types type
	if (body.response_types !== undefined && !Array.isArray(body.response_types)) {
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'response_types must be an array',
		}, 400);
	}
	const responseTypes = body.response_types || ['code'];

	// Validate grant_types values
	const validGrantTypes = new Set(['authorization_code', 'refresh_token']);
	for (const gt of grantTypes) {
		if (typeof gt !== 'string' || !validGrantTypes.has(gt)) {
			return context.json({
				error: 'invalid_client_metadata',
				error_description: `Unsupported grant_type: ${gt}`,
			}, 400);
		}
	}

	// Validate response_types values
	for (const rt of responseTypes) {
		if (typeof rt !== 'string') {
			return context.json({
				error: 'invalid_client_metadata',
				error_description: 'response_types must contain strings',
			}, 400);
		}
	}
	if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
		return context.json({
			error: 'invalid_client_metadata',
			error_description: 'Only response_type "code" is supported',
		}, 400);
	}

	// Generate a secure client_id
	const clientId = randomBytes(16).toString('hex');
	const clientIdIssuedAt = Math.floor(Date.now() / 1000);

	// Store client in database
	try {
		await query(
			`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, client_id_issued_at)
			 VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))`,
			[
				clientId,
				clientName,
				uniqueRedirectUris,
				tokenEndpointAuthMethod,
				grantTypes,
				responseTypes,
				clientIdIssuedAt,
			]
		);
	} catch (error) {
		console.error('Failed to register OAuth client:', error);
		return context.json({
			error: 'server_error',
			error_description: 'Failed to register client',
		}, 500);
	}

	// Return client registration response (RFC 7591)
	return context.json({
		client_id: clientId,
		client_name: clientName,
		redirect_uris: uniqueRedirectUris,
		token_endpoint_auth_method: tokenEndpointAuthMethod,
		grant_types: grantTypes,
		response_types: responseTypes,
		client_id_issued_at: clientIdIssuedAt,
	}, 201);
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
 * Build a safe return URL for login redirect
 * Uses relative path only, validates length and path prefix
 */
function buildSafeReturnUrl(requestUrl: string): string | null {
	try {
		const url = new URL(requestUrl);
		const relativePath = url.pathname + url.search;

		// Validate path starts with /oauth/ (only redirect back to OAuth endpoints)
		if (!relativePath.startsWith('/oauth/')) {
			return null;
		}

		// Validate length (2000 chars is a safe limit for URLs)
		if (relativePath.length > 2000) {
			return null;
		}

		return relativePath;
	} catch {
		return null;
	}
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
		// Redirect to login with return URL (relative path only)
		const returnUrl = buildSafeReturnUrl(context.req.url);
		if (!returnUrl) {
			return context.redirect('/login');
		}
		return context.redirect(`/login?next=${encodeURIComponent(returnUrl)}`);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		const returnUrl = buildSafeReturnUrl(context.req.url);
		if (!returnUrl) {
			return context.redirect('/login');
		}
		return context.redirect(`/login?next=${encodeURIComponent(returnUrl)}`);
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
	if (!clientId) {
		return context.json({ error: 'invalid_client', error_description: 'client_id required' }, 400);
	}

	// Look up client in database
	let client: OAuthClient | null;
	try {
		client = await getClient(clientId);
	} catch (error) {
		console.error('Database error looking up OAuth client:', error);
		return context.json({ error: 'server_error', error_description: 'Internal server error' }, 500);
	}
	if (!client) {
		return context.json({ error: 'invalid_client', error_description: 'Unknown client' }, 400);
	}

	if (responseType !== 'code') {
		return context.json({ error: 'unsupported_response_type' }, 400);
	}

	if (!redirectUri) {
		return context.json({ error: 'invalid_request', error_description: 'redirect_uri required' }, 400);
	}

	// Validate redirect_uri against client's registered URIs
	if (!isRedirectUriAllowedForClient(redirectUri, client)) {
		return context.json({ error: 'invalid_request', error_description: 'redirect_uri not allowed' }, 400);
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
		action: string;
		csrf_token: string;
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
			action: String(formData.action || ''),
			csrf_token: String(formData.csrf_token || ''),
		};
	}

	const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, device_name, action } = body;

	// Note: CSRF protection is handled by csrfMiddleware which validates the X-CSRF-Token header
	// No manual validation needed here

	// Validate action field
	if (action !== 'approve' && action !== 'deny') {
		return context.json({ error: 'invalid_request', error_description: 'Invalid action' }, 400);
	}

	// Look up client from database (must happen before redirect_uri validation)
	if (!client_id) {
		return context.json({ error: 'invalid_client', error_description: 'client_id required' }, 400);
	}

	let client: OAuthClient | null;
	try {
		client = await getClient(client_id);
	} catch (error) {
		console.error('Database error looking up OAuth client:', error);
		return context.json({ error: 'server_error', error_description: 'Internal server error' }, 500);
	}
	if (!client) {
		return context.json({ error: 'invalid_client', error_description: 'Unknown client' }, 400);
	}

	// Validate redirect_uri BEFORE using it (security: prevent open redirect)
	if (!redirect_uri || !isRedirectUriAllowedForClient(redirect_uri, client)) {
		return context.json({ error: 'invalid_request', error_description: 'redirect_uri not allowed' }, 400);
	}

	// Build redirect URL (safe now that we've validated)
	const redirectUrl = new URL(redirect_uri);

	// If denied, return redirect URL in JSON (browser can't read Location header from opaque redirect)
	if (action === 'deny') {
		redirectUrl.searchParams.set('error', 'access_denied');
		redirectUrl.searchParams.set('error_description', 'The resource owner denied the request');
		if (state) redirectUrl.searchParams.set('state', state);
		return context.json({ redirect_url: redirectUrl.toString() });
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

	// Sanitize device name for safe display
	const sanitizedDeviceName = sanitizeForDisplay(device_name.trim());

	// Store authorization code
	await query(
		`INSERT INTO oauth_codes (code, user_id, client_id, device_name, code_challenge, code_challenge_method, scopes, redirect_uri, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[code, session.userId, client_id, sanitizedDeviceName, code_challenge, code_challenge_method, scopes, redirect_uri, expiresAt]
	);

	// Return redirect URL in JSON (browser can't read Location header from opaque redirect)
	redirectUrl.searchParams.set('code', code);
	if (state) redirectUrl.searchParams.set('state', state);

	return context.json({ redirect_url: redirectUrl.toString() });
}

/**
 * Token endpoint - exchange code for tokens or refresh
 * POST /oauth/token
 */
export async function handleToken(context: Context): Promise<Response> {
	// Parse body (form-urlencoded per OAuth spec)
	const contentType = context.req.header('content-type') || '';
	let body: Record<string, string>;

	try {
		if (contentType.includes('application/json')) {
			body = await context.req.json();
		} else {
			const formData = await context.req.parseBody();
			body = {};
			for (const [key, value] of Object.entries(formData)) {
				body[key] = String(value);
			}
		}
	} catch {
		return context.json({ error: 'invalid_request', error_description: 'Invalid request body' }, 400);
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
	if (new Date(authCode.expires_at).getTime() < Date.now()) {
		await query('DELETE FROM oauth_codes WHERE code = $1', [code]);
		return context.json({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
	}

	// Validate redirect_uri matches
	if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
		return context.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
	}

	// Validate PKCE - delete code on failure to prevent replay attacks
	if (!validatePkce(code_verifier, authCode.code_challenge, authCode.code_challenge_method)) {
		await query('DELETE FROM oauth_codes WHERE code = $1', [code]);
		return context.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
	}

	// Generate tokens
	const accessToken = generateToken();
	const refreshToken = generateToken();
	const accessTokenHash = hashToken(accessToken);
	const refreshTokenHash = hashToken(refreshToken);
	const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

	// Use transaction to ensure atomicity: code deletion and token creation
	// either both succeed or both fail (prevents orphaned state on crash)
	await transaction(async (client) => {
		await client.query('DELETE FROM oauth_codes WHERE code = $1', [code]);
		await client.query(
			`INSERT INTO mcp_tokens (user_id, client_id, device_name, access_token_hash, refresh_token_hash, scopes, expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[authCode.user_id, authCode.client_id, authCode.device_name, accessTokenHash, refreshTokenHash, authCode.scopes, refreshExpiresAt]
		);
	});

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
	if (new Date(token.expires_at).getTime() < Date.now()) {
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

	// Return array directly (SyncCollection expects array, not wrapped object)
	return context.json(result.rows.map(row => ({
		id: row.id,
		client_id: row.client_id,
		device_name: row.device_name,
		scopes: row.scopes,
		created_at: row.created_at,
		last_used_at: row.last_used_at,
	})));
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
