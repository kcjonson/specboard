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
 * MCP auth middleware - validates Bearer token and attaches user info
 */
export function mcpAuthMiddleware() {
	return async (c: Context<{ Variables: McpAuthVariables }>, next: Next) => {
		const authHeader = c.req.header('Authorization');
		const token = extractBearerToken(authHeader);

		if (!token) {
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
			return c.json({
				error: 'auth_required',
				message: 'Invalid access token',
			}, 401);
		}

		// Check expiration (tokens expire based on refresh token lifetime stored in expires_at)
		if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
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
