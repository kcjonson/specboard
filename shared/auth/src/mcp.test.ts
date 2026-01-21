/**
 * MCP auth middleware tests
 *
 * Tests for Bearer token validation and OAuth discovery headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { mcpAuthMiddleware, requireScope, getMcpToken, type McpAuthVariables } from './mcp.ts';

// Mock database
vi.mock('@doc-platform/db', () => ({
	query: vi.fn(),
}));

import { query } from '@doc-platform/db';

describe('MCP auth middleware', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('mcpAuthMiddleware', () => {
		it('should return 401 with WWW-Authenticate header when no Authorization header', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
			});

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.error).toBe('auth_required');
			expect(data.message).toBe('Missing or invalid Authorization header');
		});

		it('should return correct WWW-Authenticate header format (RFC 9728)', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					host: 'localhost',
					'x-forwarded-proto': 'http', // Explicitly set to http for test
				},
			});

			const wwwAuth = res.headers.get('www-authenticate');
			expect(wwwAuth).toBe('Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"');
		});

		it('should default to http for localhost when x-forwarded-proto is not set', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			// No x-forwarded-proto header - should default to http for localhost
			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					host: 'localhost',
				},
			});

			const wwwAuth = res.headers.get('www-authenticate');
			expect(wwwAuth).toBe('Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"');
		});

		it('should use x-forwarded-proto for WWW-Authenticate URL', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					host: 'staging.specboard.io',
					'x-forwarded-proto': 'https',
				},
			});

			const wwwAuth = res.headers.get('www-authenticate');
			expect(wwwAuth).toBe('Bearer resource_metadata="https://staging.specboard.io/.well-known/oauth-protected-resource"');
		});

		it('should reject malicious host headers (host header injection protection)', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			// Attacker tries to inject their own domain via host header
			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					host: 'evil-attacker.com',
					'x-forwarded-proto': 'https',
				},
			});

			const wwwAuth = res.headers.get('www-authenticate');
			// Should NOT contain the attacker's domain
			expect(wwwAuth).not.toContain('evil-attacker.com');
			// Should fall back to safe default
			expect(wwwAuth).toBe('Bearer resource_metadata="https://specboard.io/.well-known/oauth-protected-resource"');
		});

		it('should return 401 when Authorization header is not Bearer', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Basic dXNlcjpwYXNz',
				},
			});

			expect(res.status).toBe(401);
			expect(res.headers.get('www-authenticate')).toContain('Bearer');
		});

		it('should return 401 when token is not found in database', async () => {
			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer invalid-token',
				},
			});

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.message).toBe('Invalid access token');
		});

		it('should return 401 when token is expired', async () => {
			const expiredDate = new Date(Date.now() - 1000); // 1 second ago

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read'],
					expires_at: expiredDate,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer some-token',
				},
			});

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.message).toBe('Access token expired');
		});

		it('should authenticate valid token and attach payload to context', async () => {
			const validDate = new Date(Date.now() + 3600000); // 1 hour from now

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read', 'tasks:write'],
					expires_at: validDate,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => {
				const token = getMcpToken(c);
				return c.json({
					userId: token?.userId,
					clientId: token?.clientId,
					scopes: token?.scopes,
				});
			});

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token',
				},
			});

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.userId).toBe('user-123');
			expect(data.clientId).toBe('claude-code');
			expect(data.scopes).toEqual(['docs:read', 'tasks:write']);
		});

		it('should hash token before database lookup (not store plaintext)', async () => {
			const token = 'my-secret-token';
			const expectedHash = createHash('sha256').update(token).digest('hex');

			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			// Verify query was called with hashed token, not plaintext
			expect(query).toHaveBeenCalledWith(
				expect.stringContaining('access_token_hash'),
				[expectedHash]
			);
		});
	});

	describe('requireScope', () => {
		it('should pass when token has required scope', async () => {
			const validDate = new Date(Date.now() + 3600000);

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read', 'docs:write'],
					expires_at: validDate,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp/*', mcpAuthMiddleware());
			app.post('/mcp/write', requireScope('docs:write'), (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp/write', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token',
				},
			});

			expect(res.status).toBe(200);
		});

		it('should return 403 when token lacks required scope', async () => {
			const validDate = new Date(Date.now() + 3600000);

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read'], // Only read scope
					expires_at: validDate,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp/*', mcpAuthMiddleware());
			app.post('/mcp/write', requireScope('docs:write'), (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp/write', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer valid-token',
				},
			});

			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.error).toBe('insufficient_scope');
			expect(data.message).toContain('docs:write');
			expect(data.details.required).toBe('docs:write');
			expect(data.details.provided).toEqual(['docs:read']);
		});

		it('should return 401 when no token payload exists', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			// Skip auth middleware, go straight to scope check
			app.post('/mcp/write', requireScope('docs:write'), (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp/write', {
				method: 'POST',
			});

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.error).toBe('auth_required');
		});
	});

	/**
	 * Security Tests
	 */
	describe('Security: Token Handling', () => {
		it('should never log or expose plaintext tokens', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			vi.mocked(query).mockRejectedValue(new Error('Database error'));

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const secretToken = 'super-secret-token-12345';

			// This will cause an error to be logged
			try {
				await app.request('http://localhost/mcp', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${secretToken}`,
					},
				});
			} catch {
				// Expected to fail - we're testing that tokens aren't logged
			}

			// Check that the token was not logged
			for (const call of consoleSpy.mock.calls) {
				const logMessage = call.join(' ');
				expect(logMessage).not.toContain(secretToken);
			}

			consoleSpy.mockRestore();
		});

		it('should use SHA-256 for token hashing', async () => {
			const token = 'test-token';
			const expectedHash = createHash('sha256').update(token).digest('hex');

			// Verify hash is 64 characters (256 bits in hex)
			expect(expectedHash).toHaveLength(64);

			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			expect(query).toHaveBeenCalledWith(
				expect.any(String),
				[expectedHash]
			);
		});
	});

	describe('Security: Bearer Token Extraction', () => {
		it('should reject malformed Bearer tokens', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const malformedHeaders = [
				'Bearer', // Missing token
				'Bearer ', // Empty token
				'bearer token', // Wrong case (Bearer is case-sensitive per RFC 6750)
				'Token abc123', // Wrong scheme
				'abc123', // No scheme
			];

			for (const auth of malformedHeaders) {
				const res = await app.request('http://localhost/mcp', {
					method: 'POST',
					headers: {
						Authorization: auth,
					},
				});

				expect(res.status).toBe(401);
			}
		});

		it('should extract token correctly with extra whitespace', async () => {
			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			// Token with extra spaces should still work
			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer   abc123', // Extra spaces
				},
			});

			// Should proceed to token lookup (and fail there), not fail on extraction
			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.message).toBe('Invalid access token'); // Token lookup failed, not extraction
		});
	});

	describe('Security: WWW-Authenticate Header', () => {
		it('should always include WWW-Authenticate on 401 responses', async () => {
			const scenarios = [
				{ auth: undefined, description: 'no auth header' },
				{ auth: 'Bearer invalid', description: 'invalid token' },
				{ auth: 'Basic abc', description: 'wrong scheme' },
			];

			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			for (const scenario of scenarios) {
				const headers: Record<string, string> = {};
				if (scenario.auth) {
					headers.Authorization = scenario.auth;
				}

				const res = await app.request('http://localhost/mcp', {
					method: 'POST',
					headers,
				});

				expect(res.status).toBe(401);
				expect(res.headers.get('www-authenticate')).toBeTruthy();
				expect(res.headers.get('www-authenticate')).toContain('Bearer');
				expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
			}
		});

		it('should point to correct protected resource metadata URL for allowed hosts', async () => {
			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			// Use an allowed host (staging.specboard.io)
			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					host: 'staging.specboard.io',
					'x-forwarded-proto': 'https',
				},
			});

			const wwwAuth = res.headers.get('www-authenticate');
			expect(wwwAuth).toContain('https://staging.specboard.io/.well-known/oauth-protected-resource');
		});
	});

	describe('Security: Token Expiration', () => {
		it('should reject tokens that expired 1ms ago', async () => {
			// Token that expired 1ms in the past should be rejected
			const justExpired = new Date(Date.now() - 1);

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read'],
					expires_at: justExpired,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer some-token',
				},
			});

			expect(res.status).toBe(401);
			const data = await res.json();
			expect(data.message).toBe('Access token expired');
		});

		it('should accept tokens expiring 1ms in the future', async () => {
			const nearFuture = new Date(Date.now() + 1);

			vi.mocked(query).mockResolvedValue({
				rows: [{
					id: 'token-id',
					user_id: 'user-123',
					client_id: 'claude-code',
					device_name: 'Test Device',
					scopes: ['docs:read'],
					expires_at: nearFuture,
				}],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono<{ Variables: McpAuthVariables }>();
			app.use('/mcp', mcpAuthMiddleware());
			app.post('/mcp', (c) => c.json({ success: true }));

			const res = await app.request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer some-token',
				},
			});

			expect(res.status).toBe(200);
		});
	});
});
