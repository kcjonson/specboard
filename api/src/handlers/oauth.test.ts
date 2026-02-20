/**
 * OAuth handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
	handleOAuthMetadata,
	handleProtectedResourceMetadata,
	handleAuthorizeGet,
	handleAuthorizePost,
	handleToken,
	handleRevoke,
	handleClientRegistration,
} from './oauth.ts';

// Mock database
vi.mock('@specboard/db', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

// Mock auth
vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(),
	SESSION_COOKIE_NAME: 'session',
}));

import { query } from '@specboard/db';
import { getSession, type Session } from '@specboard/auth';
import type { Redis } from 'ioredis';

// Helper to create a valid mock session
function createMockSession(userId: string): Session {
	return {
		userId,
		csrfToken: 'mock-csrf-token',
		createdAt: Date.now(),
		lastAccessedAt: Date.now(),
	};
}

// Create a mock Redis instance with minimal type safety
const mockRedis = {} as Redis;

// Standard mock client data for tests
const mockClientData = {
	client_id: 'claude-code',
	client_name: 'Claude Code',
	redirect_uris: [
		'http://localhost:3000/callback',
		'http://127.0.0.1:8080/callback',
		'https://claude.ai/api/mcp/auth_callback',
		'https://claude.com/api/mcp/auth_callback',
	],
	token_endpoint_auth_method: 'none',
	grant_types: ['authorization_code', 'refresh_token'],
	response_types: ['code'],
};

// Standard mock user data
const mockUserData = { id: 'user-123', email: 'test@example.com' };

// Helper to set up standard mocks for client + user lookup
function setupClientAndUserMocks(): void {
	vi.mocked(query).mockImplementation(async (sql: string) => {
		// Check if this is a client lookup or user lookup based on SQL
		if (sql.includes('oauth_clients')) {
			return {
				rows: [mockClientData],
				rowCount: 1,
				command: 'SELECT',
				oid: 0,
				fields: [],
			};
		}
		// Default to user lookup
		return {
			rows: [mockUserData],
			rowCount: 1,
			command: 'SELECT',
			oid: 0,
			fields: [],
		};
	});
}

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
				registration_endpoint: 'http://localhost/oauth/register',
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
		// Use global mockRedis

		beforeEach(() => {
			// Mock authenticated session
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));
			// Mock database queries for client + user lookup
			setupClientAndUserMocks();
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
			expect(data.error_description).toBe('redirect_uri not allowed');
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
			// Override mock to return empty client result
			vi.mocked(query).mockImplementation(async (sql: string) => {
				if (sql.includes('oauth_clients')) {
					return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
				}
				return { rows: [mockUserData], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
			});

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
		// Use global mockRedis

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));
			setupClientAndUserMocks();
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

		it('should validate redirect_uri in POST handler (prevent bypass)', async () => {
			// This test ensures the POST handler also validates redirect_uri
			// An attacker could try to bypass GET validation by directly POSTing
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));

			const app = new Hono();
			app.post('/oauth/authorize', (c) => handleAuthorizePost(c, mockRedis));

			// Attempt to POST with a malicious redirect_uri
			// Include valid CSRF token to test redirect_uri validation (not CSRF)
			const res = await app.request('http://localhost/oauth/authorize', {
				method: 'POST',
				headers: {
					cookie: 'session=valid-session-id',
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					client_id: 'claude-code',
					redirect_uri: 'https://attacker.com/steal-code', // Malicious!
					scope: 'docs:read',
					state: 'test-state',
					code_challenge: 'test-challenge',
					code_challenge_method: 'S256',
					device_name: 'Test Device',
					action: 'approve',
					csrf_token: 'mock-csrf-token', // Valid CSRF to test redirect_uri validation
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
			expect(data.error_description).toBe('redirect_uri not allowed');
		});
	});

	describe('Security: PKCE Enforcement', () => {
		// Use global mockRedis

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));
			setupClientAndUserMocks();
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
		// Use global mockRedis

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
		// Use global mockRedis

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));
		});

		it('should reject unknown client IDs', async () => {
			// Mock empty client result for unknown clients
			vi.mocked(query).mockImplementation(async (sql: string) => {
				if (sql.includes('oauth_clients')) {
					return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
				}
				return { rows: [mockUserData], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
			});

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
			setupClientAndUserMocks();

			const app = new Hono();
			app.get('/oauth/authorize', (c) => handleAuthorizeGet(c, mockRedis));

			// Test allowed clients (both should work with the mock client data)
			const allowedClients = ['claude-code', 'specboard-cli'];

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
		// Use global mockRedis

		beforeEach(() => {
			vi.mocked(getSession).mockResolvedValue(createMockSession('user-123'));
			setupClientAndUserMocks();
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

	/**
	 * Client Registration Tests (RFC 7591)
	 * These tests cover the dynamic client registration endpoint
	 */
	describe('handleClientRegistration', () => {
		beforeEach(() => {
			vi.mocked(query).mockResolvedValue({
				rows: [],
				rowCount: 0,
				command: 'INSERT',
				oid: 0,
				fields: [],
			});
		});

		it('should successfully register a client with minimal required fields', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.client_id).toBeDefined();
			expect(data.client_id.length).toBe(32); // 16 bytes hex
			expect(data.redirect_uris).toEqual(['http://localhost:3000/callback']);
			expect(data.token_endpoint_auth_method).toBe('none');
			expect(data.grant_types).toEqual(['authorization_code', 'refresh_token']);
			expect(data.response_types).toEqual(['code']);
			expect(data.client_id_issued_at).toBeDefined();
		});

		it('should successfully register a client with all optional fields', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 'Test Client',
					redirect_uris: ['http://localhost:3000/callback', 'https://example.com/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code'],
					response_types: ['code'],
				}),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.client_name).toBe('Test Client');
			expect(data.redirect_uris).toEqual(['http://localhost:3000/callback', 'https://example.com/callback']);
		});

		it('should reject invalid JSON body', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'not valid json',
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_request');
			expect(data.error_description).toBe('Invalid JSON body');
		});

		it('should reject missing redirect_uris', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 'Test Client',
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_redirect_uri');
			expect(data.error_description).toContain('redirect_uri is required');
		});

		it('should reject empty redirect_uris array', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: [],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_redirect_uri');
		});

		it('should reject non-array redirect_uris', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: 'http://localhost:3000/callback',
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_redirect_uri');
		});

		it('should reject too many redirect_uris', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: Array(21).fill('http://localhost:3000/callback'),
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toContain('Too many redirect_uris');
		});

		it('should reject invalid redirect_uri format', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['not-a-valid-url'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_redirect_uri');
			// Should NOT include the malicious URI in the error message
			expect(data.error_description).not.toContain('not-a-valid-url');
		});

		it('should reject http URLs for non-localhost', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://example.com/callback'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_redirect_uri');
		});

		it('should allow http for localhost', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:8080/callback'],
				}),
			});

			expect(res.status).toBe(201);
		});

		it('should allow http for 127.0.0.1', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://127.0.0.1:8080/callback'],
				}),
			});

			expect(res.status).toBe(201);
		});

		it('should deduplicate redirect_uris', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: [
						'http://localhost:3000/callback',
						'http://localhost:3000/callback',
						'https://example.com/callback',
					],
				}),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.redirect_uris).toEqual([
				'http://localhost:3000/callback',
				'https://example.com/callback',
			]);
		});

		it('should reject non-string client_name', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 123,
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('client_name must be a string');
		});

		it('should reject empty client_name', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: '',
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('client_name must not be empty or whitespace');
		});

		it('should reject whitespace-only client_name', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: '   ',
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('client_name must not be empty or whitespace');
		});

		it('should reject client_name that is too long', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 'a'.repeat(256),
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toContain('too long');
		});

		it('should trim client_name and store trimmed version', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: '  Test Client  ',
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(201);
			const data = await res.json();
			expect(data.client_name).toBe('Test Client');
		});

		it('should reject non-string token_endpoint_auth_method', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					token_endpoint_auth_method: 123,
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('token_endpoint_auth_method must be a string');
		});

		it('should reject unsupported token_endpoint_auth_method', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					token_endpoint_auth_method: 'client_secret_basic',
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toContain('Only token_endpoint_auth_method "none" is supported');
		});

		it('should reject non-array grant_types', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					grant_types: 'authorization_code',
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('grant_types must be an array');
		});

		it('should reject unsupported grant_types', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					grant_types: ['password'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toContain('Unsupported grant_type');
		});

		it('should reject non-array response_types', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					response_types: 'code',
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toBe('response_types must be an array');
		});

		it('should reject unsupported response_types', async () => {
			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
					response_types: ['token'],
				}),
			});

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('invalid_client_metadata');
			expect(data.error_description).toContain('Only response_type "code" is supported');
		});

		it('should handle database errors gracefully', async () => {
			vi.mocked(query).mockRejectedValueOnce(new Error('Database connection failed'));

			const app = new Hono();
			app.post('/oauth/register', handleClientRegistration);

			const res = await app.request('http://localhost/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					redirect_uris: ['http://localhost:3000/callback'],
				}),
			});

			expect(res.status).toBe(500);
			const data = await res.json();
			expect(data.error).toBe('server_error');
			expect(data.error_description).toBe('Failed to register client');
		});
	});
});
