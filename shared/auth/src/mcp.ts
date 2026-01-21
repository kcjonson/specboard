/**
 * MCP OAuth token validation middleware
 * Validates Bearer tokens for MCP server requests
 */

import { createHash } from 'node:crypto';
import type { Context, Next } from 'hono';
import { query } from '@doc-platform/db';

export interface McpTokenPayload {
	userId: string;
	clientId: string;
	deviceName: string;
	scopes: string[];
}

export interface McpAuthVariables {
	mcpToken: McpTokenPayload;
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return null;
	}
	return authHeader.slice(7);
}

/**
 * Allowed hosts for OAuth protected resource metadata.
 * Used to prevent host header injection attacks.
 */
const ALLOWED_HOSTS = new Set([
	'localhost',
	'specboard.io',
	'staging.specboard.io',
	'www.specboard.io',
]);

/**
 * Build the WWW-Authenticate header value for 401 responses
 * Per MCP OAuth spec (RFC 9728), this tells the client where to find
 * the protected resource metadata for OAuth discovery.
 *
 * Security: Validates host header against allowlist to prevent injection attacks.
 * Falls back to configured MCP_BASE_URL environment variable if available.
 */
function buildWwwAuthenticateHeader(c: Context): string {
	// First, try environment variable (most secure - can't be manipulated by client)
	const configuredBaseUrl = process.env.MCP_BASE_URL;
	if (configuredBaseUrl) {
		return `Bearer resource_metadata="${configuredBaseUrl}/.well-known/oauth-protected-resource"`;
	}

	// Fall back to validated host header (for local development)
	const host = c.req.header('host') || 'localhost';
	const hostWithoutPort = host.split(':')[0]!;

	// Validate host against allowlist
	if (!ALLOWED_HOSTS.has(hostWithoutPort)) {
		// For unrecognized hosts, use a safe default
		console.warn(`[mcp-auth] Rejecting unrecognized host: ${host}`);
		return `Bearer resource_metadata="https://specboard.io/.well-known/oauth-protected-resource"`;
	}

	// Determine protocol: use header if present, otherwise default based on host
	const protoHeader = c.req.header('x-forwarded-proto');
	const proto = protoHeader ||
		(hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1' ? 'http' : 'https');
	const baseUrl = `${proto}://${host}`;
	return `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`;
}

/**
 * MCP auth middleware - validates Bearer token and attaches user info
 */
export function mcpAuthMiddleware() {
	return async (c: Context<{ Variables: McpAuthVariables }>, next: Next) => {
		const authHeader = c.req.header('Authorization');
		const token = extractBearerToken(authHeader);

		if (!token) {
			c.header('WWW-Authenticate', buildWwwAuthenticateHeader(c));
			return c.json({
				error: 'auth_required',
				message: 'Missing or invalid Authorization header',
			}, 401);
		}

		const tokenHash = hashToken(token);

		// Look up token
		const result = await query<{
			id: string;
			user_id: string;
			client_id: string;
			device_name: string;
			scopes: string[];
			expires_at: Date;
		}>(
			'SELECT id, user_id, client_id, device_name, scopes, expires_at FROM mcp_tokens WHERE access_token_hash = $1',
			[tokenHash]
		);

		const tokenRecord = result.rows[0];
		if (!tokenRecord) {
			c.header('WWW-Authenticate', buildWwwAuthenticateHeader(c));
			return c.json({
				error: 'auth_required',
				message: 'Invalid access token',
			}, 401);
		}

		// Check expiration (tokens expire based on refresh token lifetime stored in expires_at)
		if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
			c.header('WWW-Authenticate', buildWwwAuthenticateHeader(c));
			return c.json({
				error: 'auth_required',
				message: 'Access token expired',
			}, 401);
		}

		// Update last_used_at (fire and forget - non-critical for request flow)
		// Errors are logged but don't affect the request since this is tracking data
		query('UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1', [tokenRecord.id]).catch((err: unknown) => {
			// Log error for monitoring - in production, this should integrate with
			// the application's logging infrastructure (e.g., structured JSON logs)
			console.error('[mcp-auth] Failed to update last_used_at for token', tokenRecord.id, err);
		});

		// Attach token info to context
		c.set('mcpToken', {
			userId: tokenRecord.user_id,
			clientId: tokenRecord.client_id,
			deviceName: tokenRecord.device_name,
			scopes: tokenRecord.scopes,
		});

		await next();
	};
}

/**
 * Scope checking middleware factory
 * Use after mcpAuthMiddleware to require specific scopes
 */
export function requireScope(requiredScope: string) {
	return async (c: Context<{ Variables: McpAuthVariables }>, next: Next) => {
		const tokenPayload = c.get('mcpToken');

		if (!tokenPayload) {
			return c.json({
				error: 'auth_required',
				message: 'Not authenticated',
			}, 401);
		}

		if (!tokenPayload.scopes.includes(requiredScope)) {
			return c.json({
				error: 'insufficient_scope',
				message: `This operation requires the '${requiredScope}' scope`,
				details: {
					required: requiredScope,
					provided: tokenPayload.scopes,
				},
			}, 403);
		}

		await next();
	};
}

/**
 * Get MCP token payload from context
 */
export function getMcpToken(c: Context<{ Variables: McpAuthVariables }>): McpTokenPayload | undefined {
	return c.get('mcpToken');
}
