/**
 * OAuth handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
	handleOAuthMetadata,
	handleProtectedResourceMetadata,
	handleAuthorizeGet,
	handleToken,
	handleRevoke,
} from './oauth.ts';

// Mock database
vi.mock('@doc-platform/db', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

// Mock auth
vi.mock('@doc-platform/auth', () => ({
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session',
}));

import { query } from '@doc-platform/db';
import { getSession } from '@doc-platform/auth';

describe('oauth handlers', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('handleOAuthMetadata', () => {
		it('should return correct OAuth authorization server metadata', async () => {
			const app = new Hono();
			app.get('/.well-known/oauth-authorization-server', handleOAuthMetadata);

			const res = await app.request('http://localhost/.well-known/oauth-authorization-server');
			const data = await res.json();

			expect(res.status).toBe(200);
			expect(data).toEqual({
				issuer: 'http://localhost',
				authorization_endpoint: 'http://localhost/oauth/authorize',
				token_endpoint: 'http://localhost/oauth/token',
				revocation_endpoint: 'http://localhost/oauth/revoke',
				scopes_supported: ['docs:read', 'docs:write', 'tasks:read', 'tasks:write'],
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code', 'refresh_token'],
				code_challenge_methods_supported: ['S256'],
				token_endpoint_auth_methods_supported: ['none'],
			});
		});

		it('should respect x-forwarded-proto header', async () => {
			const app = new Hono();
			app.get('/.well-known/oauth-authorization-server', handleOAuthMetadata);

			const res = await app.request('http://localhost/.well-known/oauth-authorization-server', {
				headers: { 'x-forwarded-proto': 'https' },
			});
			const data = await res.json();

			expect(data.issuer).toBe('https://localhost');
			expect(data.authorization_endpoint).toBe('https://localhost/oauth/authorize');
		});

		it('should use host header for base URL', async () => {
			const app = new Hono();
			app.get('/.well-known/oauth-authorization-server', handleOAuthMetadata);

			const res = await app.request('http://localhost/.well-known/oauth-authorization-server', {
				headers: {
					host: 'staging.specboard.io',
					'x-forwarded-proto': 'https',
				},
			});
			const data = await res.json();

			expect(data.issuer).toBe('https://staging.specboard.io');
		});
	});

	describe('handleProtectedResourceMetadata', () => {
		it('should return correct protected resource metadata', async () => {
			const app = new Hono();
			app.get('/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);

			const res = await app.request('http://localhost/.well-known/oauth-protected-resource');
			const data = await res.json();

			expect(res.status).toBe(200);
			expect(data).toEqual({
				resource: 'http://localhost/mcp',
				authorization_servers: ['http://localhost'],
				scopes_supported: ['docs:read', 'docs:write', 'tasks:read', 'tasks:write'],
			});
		});

		it('should use x-forwarded-proto for resource URL', async () => {
			const app = new Hono();
			app.get('/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);

			const res = await app.request('http://localhost/.well-known/oauth-protected-resource', {
				headers: {
					'x-forwarded-proto': 'https',
					host: 'staging.specboard.io',
				},
			});
			const data = await res.json();

			expect(data.resource).toBe('https://staging.specboard.io/mcp');
			expect(data.authorization_servers).toEqual(['https://staging.specboard.io']);
		});
	});

	describe('handleAuthorizeGet - redirect URI validation', () => {
		const mockRedis = {} as any;

		beforeEach(() => {
			// Mock authenticated session
			vi.mocked(getSession).mockResolvedValue({
				userId: 'user-123',
				email: 'test@example.com',
				roles: ['user'],
			});
			// Mock user lookup
			vi.mocked(query).mockResolvedValue({
				rows: [{ id: 'user-123', email: 'test@example.com' }],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});
		});

		it('should allow localhost redirect URI', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			// Should redirect to consent page (302), not error (400)
			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/oauth/consent');
		});

		it('should allow 127.0.0.1 redirect URI', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://127.0.0.1:8080/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(302);
		});

		it('should allow claude.ai redirect URI', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(302);
		});

		it('should allow claude.com redirect URI', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'https://claude.com/api/mcp/auth_callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(302);
		});

		it('should reject unauthorized redirect URIs', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'https://evil.com/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
			expect(data.error_description).toBe('redirect_uri not allowed');
		});

		it('should reject https localhost (only http allowed for localhost)', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'https://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error_description).toBe('redirect_uri not allowed');
		});

		it('should reject invalid redirect URI format', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'not-a-valid-url');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error_description).toBe('Invalid redirect_uri');
		});

		it('should require PKCE with S256', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			// Missing code_challenge

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error_description).toContain('PKCE required');
		});

		it('should reject unknown client_id', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'unknown-client');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client');
		});

		it('should redirect to login if no session', async () => {
			vi.mocked(getSession).mockResolvedValue(null);

			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString());

			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/login');
		});
	});

	describe('handleToken - grant types', () => {
		it('should reject unsupported grant types', async () => {
			const app = new Hono();
			app.post('/oauth/token', handleToken);

			const res = await app.request('http://localhost/oauth/token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ grant_type: 'password' }),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('unsupported_grant_type');
		});

		it('should require code and code_verifier for authorization_code grant', async () => {
			const app = new Hono();
			app.post('/oauth/token', handleToken);

			const res = await app.request('http://localhost/oauth/token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ grant_type: 'authorization_code' }),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
			expect(data.error_description).toContain('code and code_verifier required');
		});

		it('should require refresh_token for refresh_token grant', async () => {
			const app = new Hono();
			app.post('/oauth/token', handleToken);

			const res = await app.request('http://localhost/oauth/token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ grant_type: 'refresh_token' }),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
			expect(data.error_description).toContain('refresh_token required');
		});
	});

	describe('handleRevoke', () => {
		it('should return 200 even for unknown tokens (RFC 7009)', async () => {
			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'DELETE',
				oid: 0,
				fields: [],
			});

			const app = new Hono();
			app.post('/oauth/revoke', handleRevoke);

			const res = await app.request('http://localhost/oauth/revoke', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: 'unknown-token' }),
			});

			expect(res.status).toBe(200);
		});

		it('should require token parameter', async () => {
			const app = new Hono();
			app.post('/oauth/revoke', handleRevoke);

			const res = await app.request('http://localhost/oauth/revoke', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
		});
	});

	/**
	 * Security Tests
	 * These tests explicitly verify security-critical behaviors
	 */
	describe('Security: Open Redirect Prevention', () => {
		const mockRedis = {} as any;

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue({
				userId: 'user-123',
				email: 'test@example.com',
				roles: ['user'],
			});
			vi.mocked(query).mockResolvedValue({
				rows: [{ id: 'user-123', email: 'test@example.com' }],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});
		});

		it('should prevent open redirect via redirect_uri to arbitrary domains', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const maliciousUris = [
				'https://attacker.com/steal-code',
				'https://evil.example.com/callback',
				'http://phishing-site.com/oauth',
				'https://claude.ai.evil.com/callback', // Similar domain attack
				'https://not-claude.ai/api/mcp/auth_callback',
			];

			for (const uri of maliciousUris) {
				const url = new URL('http://localhost/oauth/authorize');
				url.searchParams.set('client_id', 'claude-code');
				url.searchParams.set('redirect_uri', uri);
				url.searchParams.set('response_type', 'code');
				url.searchParams.set('scope', 'docs:read');
				url.searchParams.set('code_challenge', 'test-challenge');
				url.searchParams.set('code_challenge_method', 'S256');

				const res = await app.request(url.toString(), {
					headers: { cookie: 'session=valid-session-id' },
				});

				expect(res.status).toBe(400);
				const data = await res.json();
				expect(data.error).toBe('invalid_request');
			}
		});

		it('should prevent redirect_uri with path traversal', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			// Attempt path traversal on allowed domain
			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'https://claude.ai/../../../evil-path');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			// Should reject because full URI doesn't match exactly
			expect(res.status).toBe(400);
		});

		it('should prevent javascript: URI scheme', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'javascript:alert(1)');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
		});
	});

	describe('Security: PKCE Enforcement', () => {
		const mockRedis = {} as any;

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue({
				userId: 'user-123',
				email: 'test@example.com',
				roles: ['user'],
			});
			vi.mocked(query).mockResolvedValue({
				rows: [{ id: 'user-123', email: 'test@example.com' }],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});
		});

		it('should reject authorization without PKCE code_challenge', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			// Intentionally missing code_challenge

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error_description).toContain('PKCE required');
		});

		it('should reject non-S256 code_challenge_method', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'plain'); // Weak method

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error_description).toContain('PKCE required');
			expect(data.error_description).toContain('S256');
		});
	});

	describe('Security: Session Validation', () => {
		const mockRedis = {} as any;

		it('should reject requests without session cookie', async () => {
			vi.mocked(getSession).mockResolvedValue(null);

			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			// No cookie header
			const res = await app.request(url.toString());

			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/login');
		});

		it('should reject requests with invalid session', async () => {
			vi.mocked(getSession).mockResolvedValue(null); // Session not found in Redis

			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=invalid-or-expired-session' },
			});

			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/login');
		});
	});

	describe('Security: Client Validation', () => {
		const mockRedis = {} as any;

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue({
				userId: 'user-123',
				email: 'test@example.com',
				roles: ['user'],
			});
		});

		it('should reject unknown client IDs', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const unknownClients = ['unknown', 'fake-client', 'claude-code-fake', ''];

			for (const clientId of unknownClients) {
				const url = new URL('http://localhost/oauth/authorize');
				url.searchParams.set('client_id', clientId);
				url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
				url.searchParams.set('response_type', 'code');
				url.searchParams.set('scope', 'docs:read');
				url.searchParams.set('code_challenge', 'test-challenge');
				url.searchParams.set('code_challenge_method', 'S256');

				const res = await app.request(url.toString(), {
					headers: { cookie: 'session=valid-session-id' },
				});

				expect(res.status).toBe(400);
				const data = await res.json();
				expect(data.error).toBe('invalid_client');
			}
		});

		it('should only allow pre-registered clients', async () => {
			vi.mocked(query).mockResolvedValue({
				rows: [{ id: 'user-123', email: 'test@example.com' }],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});

			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			// Test allowed clients
			const allowedClients = ['claude-code', 'doc-platform-cli'];

			for (const clientId of allowedClients) {
				const url = new URL('http://localhost/oauth/authorize');
				url.searchParams.set('client_id', clientId);
				url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
				url.searchParams.set('response_type', 'code');
				url.searchParams.set('scope', 'docs:read');
				url.searchParams.set('code_challenge', 'test-challenge');
				url.searchParams.set('code_challenge_method', 'S256');

				const res = await app.request(url.toString(), {
					headers: { cookie: 'session=valid-session-id' },
				});

				// Should proceed (302 redirect to consent), not reject (400)
				expect(res.status).toBe(302);
			}
		});
	});

	describe('Security: Scope Validation', () => {
		const mockRedis = {} as any;

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue({
				userId: 'user-123',
				email: 'test@example.com',
				roles: ['user'],
			});
			vi.mocked(query).mockResolvedValue({
				rows: [{ id: 'user-123', email: 'test@example.com' }],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			});
		});

		it('should reject requests with no valid scopes', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'invalid:scope admin:all');
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_scope');
		});

		it('should filter out invalid scopes from request', async () => {
			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			// Mix of valid and invalid scopes
			const url = new URL('http://localhost/oauth/authorize');
			url.searchParams.set('client_id', 'claude-code');
			url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'docs:read invalid:scope tasks:read'); // Contains invalid scope
			url.searchParams.set('code_challenge', 'test-challenge');
			url.searchParams.set('code_challenge_method', 'S256');

			const res = await app.request(url.toString(), {
				headers: { cookie: 'session=valid-session-id' },
			});

			// Should succeed - invalid scopes are filtered out, valid ones remain
			expect(res.status).toBe(302);
			const location = res.headers.get('location');
			expect(location).toContain('scope=docs%3Aread+tasks%3Aread'); // Only valid scopes
		});
	});
});
