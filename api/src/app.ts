/**
 * The API app: middleware and the whole route table. index.ts serves it; the
 * role-matrix suite builds it to read the registered routes.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Redis } from 'ioredis';

import {
	rateLimitMiddleware,
	csrfMiddleware,
	RATE_LIMIT_CONFIGS,
	getSession,
	SESSION_COOKIE_NAME,
} from '@specboard/auth';
import { reportError, logRequest } from '@specboard/core';
import { getCookie } from 'hono/cookie';
import { registerPlanningRoutes } from './planning-routes.ts';
import { projectAccessGate, type AppVariables } from './project-access.ts';

import {
	handleLogin,
	handleLogout,
	handleGetMe,
	handleUpdateMe,
	handleSignup,
	handleVerifyEmail,
	handleResendVerification,
	handleForgotPassword,
	handleResetPassword,
	handleChangePassword,
	handleMagicLinkRequest,
	handleMagicLinkVerify,
	handleWebauthnLoginOptions,
	handleWebauthnLoginVerify,
	handleWebauthnRegisterOptions,
	handleWebauthnRegisterVerify,
	handleListPasskeys,
	handleRenamePasskey,
	handleDeletePasskey,
} from './handlers/auth/index.ts';
import {
	handleListUsers,
	handleGetUser,
	handleCreateUser,
	handleUpdateUser,
	handleListUserTokens,
	handleRevokeUserToken,
} from './handlers/users.ts';
import {
	handleOAuthMetadata,
	handleProtectedResourceMetadata,
	handleClientRegistration,
	handleAuthorizeGet,
	handleAuthorizePost,
	handleToken,
	handleRevoke,
	handleListAuthorizations,
	handleDeleteAuthorization,
} from './handlers/oauth.ts';
import {
	handleListProjects,
	handleGetProject,
	handleCreateProject,
	handleUpdateProject,
	handleDeleteProject,
} from './handlers/projects.ts';
import {
	handleAddFolder,
	handleRemoveFolder,
	handleListFiles,
	handleReadFile,
	handleWriteFile,
	handleCreateFile,
	handleRenameFile,
	handleDeleteFile,
	handleGetGitStatus,
	handleCommit,
	handleRestore,
	handlePull,
} from './handlers/storage/index.ts';
import {
	handleListApiKeys,
	handleCreateApiKey,
	handleDeleteApiKey,
	handlePreValidateApiKey,
	handleValidateApiKey,
} from './handlers/api-keys.ts';
import { handleChat } from './handlers/chat.ts';
import {
	handleGitHubAuthStart,
	handleGitHubAuthCallback,
	handleGetGitHubConnection,
	handleGitHubDisconnect,
	handleListGitHubRepos,
	handleListGitHubBranches,
} from './handlers/github.ts';
import {
	handleGitHubSync,
	handleGitHubInitialSync,
	handleGitHubSyncStatus,
	handleGitHubCommit,
} from './handlers/github-sync.ts';
import { handleGetChatModels, handleGetChatProviders } from './handlers/chat-models.ts';
import { handleWaitlistSignup, handleListWaitlist } from './handlers/waitlist.ts';
import {
	handleListMembers,
	handleUpdateMember,
	handleRemoveMember,
	handleLeaveProject,
} from './handlers/members.ts';
import {
	handleCreateInvitation,
	handleListInvitations,
	handleResendInvitation,
	handleRevokeInvitation,
} from './handlers/invitations.ts';
import {
	handleLookupInvite,
	handleAcceptInvite,
	handleDeclineInvite,
	handleListMyInvitations,
	handleAcceptMyInvitation,
	handleDeclineMyInvitation,
} from './handlers/invite.ts';

// Allowed origins for CORS
// In production, this restricts which domains can make cross-origin requests
const getAllowedOrigins = (): string[] => {
	if (process.env.NODE_ENV === 'production') {
		return [
			'https://specboard.io',
			'https://www.specboard.io',
			'https://staging.specboard.io',
			'https://claude.ai',
			'https://claude.com',
		];
	}
	// In development, allow localhost origins
	return [
		'http://localhost',
		'http://localhost:80',
		'http://localhost:3000',
		'http://localhost:5173',
		'http://127.0.0.1',
		'http://127.0.0.1:80',
		'http://127.0.0.1:3000',
		'http://127.0.0.1:5173',
	];
};

export function createApp(redis: Redis): Hono<{ Variables: AppVariables }> {
	const app = new Hono<{ Variables: AppVariables }>();

	// Middleware - CORS with origin validation
	app.use('*', cors({
		origin: (origin) => {
			// Allow requests with no origin (e.g., curl, server-to-server)
			if (!origin) return null;
			const allowed = getAllowedOrigins();
			return allowed.includes(origin) ? origin : null;
		},
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
		// Location: OAuth redirects. X-Total-Count: list endpoints report matches past the page.
		exposeHeaders: ['Location', 'X-Total-Count'],
	}));

	// Request logging middleware
	// Note: await next() never throws in Hono - errors are caught internally and passed to app.onError()
	// We store userId in context so app.onError() can access it for error reporting
	app.use('*', async (context, next) => {
		const start = Date.now();

		// Get user ID from session if available and store in context for error reporting
		let userId: string | undefined;
		const sessionId = getCookie(context, SESSION_COOKIE_NAME);
		if (sessionId) {
			// Fail open: a Redis outage shouldn't 500 every request just to tag logs
			const session = await getSession(redis, sessionId).catch((error: unknown) => {
				console.error('Logging session lookup error:', error instanceof Error ? error.message : error);
				return null;
			});
			userId = session?.userId;
		}

		// Store in context for access by app.onError()
		context.set('userId', userId);

		await next();

		// Log the request (runs for both success and error responses)
		const duration = Date.now() - start;
		logRequest({
			method: context.req.method,
			path: context.req.path,
			status: context.res.status,
			duration,
			ip: context.req.header('x-forwarded-for') || context.req.header('x-real-ip'),
			userAgent: context.req.header('user-agent'),
			referer: context.req.header('referer'),
			userId,
			contentLength: parseInt(context.res.headers.get('content-length') || '0', 10),
		});
	});

	// Rate limiting middleware (per spec requirements)
	// Excludes /api/metrics to ensure error reports are captured even during high error rates
	app.use(
		'*',
		rateLimitMiddleware(redis, {
			rules: [
				{ path: '/api/auth/login', config: RATE_LIMIT_CONFIGS.login },
				{ path: '/api/auth/signup', config: RATE_LIMIT_CONFIGS.signup },
				{ path: '/api/auth/magic-link/request', config: RATE_LIMIT_CONFIGS.magicLinkRequest },
				{ path: '/api/auth/magic-link/verify', config: RATE_LIMIT_CONFIGS.magicLinkVerify },
				{ path: '/api/auth/webauthn/login/options', config: RATE_LIMIT_CONFIGS.webauthnLoginOptions },
				{ path: '/api/auth/webauthn/login/verify', config: RATE_LIMIT_CONFIGS.login },
				{ path: '/api/auth/forgot-password', config: RATE_LIMIT_CONFIGS.forgot },
				{ path: '/api/auth/resend-verification', config: RATE_LIMIT_CONFIGS.resendVerification },
				{ path: '/api/auth/github', config: RATE_LIMIT_CONFIGS.login }, // OAuth start - same limit as login
				{ path: '/oauth/token', config: RATE_LIMIT_CONFIGS.oauthToken },
				{ path: '/oauth/authorize', config: RATE_LIMIT_CONFIGS.oauthAuthorize },
				{ path: '/oauth/register', config: RATE_LIMIT_CONFIGS.oauthToken }, // Same limit as token endpoint
				{ path: '/api/projects/*/*/chat', config: RATE_LIMIT_CONFIGS.chat },
				// POST only: the admin GET on this same path stays on the default limit
				{ path: '/api/waitlist', method: 'POST', config: RATE_LIMIT_CONFIGS.waitlist },
				// GET only: the board reads one window per status column, so writes stay on the default
				{ path: '/api/projects/*/*/items', method: 'GET', config: RATE_LIMIT_CONFIGS.itemsList },
			],
			defaultLimit: RATE_LIMIT_CONFIGS.api,
			excludePaths: ['/health', '/api/health', '/api/metrics'],
		})
	);

	// CSRF protection for state-changing requests
	// Token validated against Redis session, cookie is just for client convenience
	// Excludes login/signup (no session yet), logout (low-impact if CSRF'd)
	// Excludes OAuth token/revoke endpoints (use PKCE instead)
	// Excludes /api/metrics (uses sendBeacon which can't send custom headers)
	app.use(
		'*',
		csrfMiddleware(redis, {
			excludePaths: [
				'/api/auth/login',
				'/api/auth/signup',
				'/api/auth/logout',
				'/api/auth/verify-email',
				'/api/auth/resend-verification',
				'/api/auth/forgot-password',
				'/api/auth/reset-password',
				'/api/auth/magic-link/request',
				'/api/auth/magic-link/verify',
				// Passkey login is pre-session (no CSRF token yet); guarded by an
				// Origin check in the handler instead. Registration/management
				// endpoints are session-authed and stay CSRF-protected.
				'/api/auth/webauthn/login/options',
				'/api/auth/webauthn/login/verify',
				'/api/auth/github/callback', // GitHub OAuth callback (comes from redirect)
				'/api/waitlist', // Public signup form
				'/api/metrics',
				'/oauth/token',
				'/oauth/revoke',
				'/oauth/register',
				'/.well-known/oauth-authorization-server',
				'/health',
				'/api/health',
			],
		})
	);

	// Cap the body on every auth endpoint. These carry only small JSON (credentials,
	// tokens, profile fields, WebAuthn payloads ~1-3 KB), several are unauthenticated,
	// and nothing else in the stack limits body size — so an uncapped body is a
	// memory-exhaustion lever. 64 KB is far above any legitimate auth payload. Scoped
	// to /api/auth/* rather than global so large-body endpoints (chat, document/file
	// writes) are unaffected. onError returns the 413 directly rather than throwing an
	// HTTPException, which the global app.onError would otherwise flatten to a 500.
	app.use('/api/auth/*', bodyLimit({
		maxSize: 64 * 1024,
		onError: (context) => context.json({ error: 'Payload too large' }, 413),
	}));

	// JSON error responses for API routes
	app.notFound((context) => {
		return context.json({ error: 'Not found' }, 404);
	});

	app.onError((error, context) => {
		// Report error to error tracking service (uses context values set by logging middleware)
		const userId = context.get('userId');
		reportError({
			name: error.name,
			message: error.message,
			stack: error.stack,
			timestamp: Date.now(),
			url: context.req.url,
			userAgent: context.req.header('user-agent'),
			userId,
			source: 'api',
			environment: process.env.NODE_ENV,
			extra: {
				method: context.req.method,
				path: context.req.path,
			},
		}).catch(() => {
			// Don't let error reporting failure affect the response
		});

		console.error('Unhandled error:', error);
		return context.json({ error: 'Internal server error' }, 500);
	});

	// Health check
	app.get('/health', (context) => context.json({ status: 'ok' }));
	app.get('/api/health', (context) => context.json({ status: 'ok' }));

	// Public waitlist signup (no auth required)
	app.post('/api/waitlist', handleWaitlistSignup);

	// Waitlist admin routes (requires admin)
	app.get('/api/waitlist', (context) => handleListWaitlist(context, redis));

	// Error reporting endpoint - receives frontend errors and forwards to error tracking service
	// Excluded from CSRF (sendBeacon can't send headers) but protected by Origin check
	app.post('/api/metrics', async (context) => {
		try {
			// Security: Validate Origin header to prevent cross-site abuse
			// Since CSRF is disabled for sendBeacon compatibility, we check Origin instead
			const origin = context.req.header('origin');
			const host = context.req.header('host');
			if (origin) {
				const originHost = new URL(origin).host;
				if (originHost !== host) {
					return context.text('forbidden', 403);
				}
			}

			const body = await context.req.json<{
				name: string;
				message: string;
				stack?: string;
				timestamp: number;
				url: string;
				userAgent: string;
				context?: Record<string, unknown>;
			}>();

			// Validate required fields
			if (
				typeof body.name !== 'string' || !body.name ||
				typeof body.message !== 'string' || !body.message ||
				typeof body.timestamp !== 'number' ||
				typeof body.url !== 'string' || !body.url ||
				typeof body.userAgent !== 'string' || !body.userAgent
			) {
				return context.text('invalid', 400);
			}

			// Get user context from session (if logged in). Fail open: a Redis
			// outage shouldn't stop the error report, just drop the userId.
			let userId: string | undefined;
			const sessionId = getCookie(context, SESSION_COOKIE_NAME);
			if (sessionId) {
				const session = await getSession(redis, sessionId).catch((error: unknown) => {
					console.error('Metrics session lookup error:', error instanceof Error ? error.message : error);
					return null;
				});
				userId = session?.userId;
			}

			await reportError({
				name: body.name,
				message: body.message,
				stack: body.stack,
				timestamp: body.timestamp,
				url: body.url,
				userAgent: body.userAgent,
				userId,
				source: 'web',
				environment: typeof body.context?.environment === 'string' ? body.context.environment : undefined,
				extra: body.context,
			});

			return context.text('accepted', 202);
		} catch (error) {
			console.error('Metrics endpoint error:', error);
			return context.text('error', 503);
		}
	});

	// Auth routes
	app.post('/api/auth/login', (context) => handleLogin(context, redis));
	app.post('/api/auth/signup', (context) => handleSignup(context, redis));
	app.post('/api/auth/logout', (context) => handleLogout(context, redis));
	app.get('/api/auth/me', (context) => handleGetMe(context, redis));
	app.put('/api/auth/me', (context) => handleUpdateMe(context, redis));

	// Magic link login routes (unauthenticated)
	app.post('/api/auth/magic-link/request', (context) => handleMagicLinkRequest(context, redis));
	app.post('/api/auth/magic-link/verify', (context) => handleMagicLinkVerify(context, redis));

	// Passkey (WebAuthn) routes
	app.post('/api/auth/webauthn/login/options', (context) => handleWebauthnLoginOptions(context, redis));
	app.post('/api/auth/webauthn/login/verify', (context) => handleWebauthnLoginVerify(context, redis));
	app.post('/api/auth/webauthn/register/options', (context) => handleWebauthnRegisterOptions(context, redis));
	app.post('/api/auth/webauthn/register/verify', (context) => handleWebauthnRegisterVerify(context, redis));
	app.get('/api/auth/webauthn/credentials', (context) => handleListPasskeys(context, redis));
	app.patch('/api/auth/webauthn/credentials/:id', (context) => handleRenamePasskey(context, redis));
	app.delete('/api/auth/webauthn/credentials/:id', (context) => handleDeletePasskey(context, redis));

	// Email verification and password reset routes (unauthenticated)
	app.post('/api/auth/verify-email', handleVerifyEmail);
	app.post('/api/auth/resend-verification', handleResendVerification);
	app.post('/api/auth/forgot-password', handleForgotPassword);
	app.post('/api/auth/reset-password', (context) => handleResetPassword(context, redis));
	app.put('/api/auth/change-password', (context) => handleChangePassword(context, redis));

	// GitHub OAuth routes
	app.get('/api/auth/github', (context) => handleGitHubAuthStart(context, redis));
	app.get('/api/auth/github/callback', (context) => handleGitHubAuthCallback(context, redis));
	app.delete('/api/auth/github', (context) => handleGitHubDisconnect(context, redis));
	app.get('/api/github/connection', (context) => handleGetGitHubConnection(context, redis));
	app.get('/api/github/repos', (context) => handleListGitHubRepos(context, redis));
	app.get('/api/github/repos/:owner/:repo/branches', (context) => handleListGitHubBranches(context, redis));

	// OAuth 2.1 routes (MCP authentication)
	app.get('/.well-known/oauth-authorization-server', handleOAuthMetadata);
	app.get('/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);
	app.post('/oauth/register', handleClientRegistration);
	app.get('/oauth/authorize', (context) => handleAuthorizeGet(context, redis));
	app.post('/oauth/authorize', (context) => handleAuthorizePost(context, redis));
	app.post('/oauth/token', handleToken);
	app.post('/oauth/revoke', handleRevoke);

	// OAuth authorization management (user settings)
	app.get('/api/oauth/authorizations', (context) => handleListAuthorizations(context, redis));
	app.delete('/api/oauth/authorizations/:id', (context) => handleDeleteAuthorization(context, redis));

	// User routes (role-based access: admin sees all, users see themselves)
	app.get('/api/users', (context) => handleListUsers(context, redis));
	app.get('/api/users/:id', (context) => handleGetUser(context, redis));
	app.post('/api/users', (context) => handleCreateUser(context, redis));
	app.put('/api/users/:id', (context) => handleUpdateUser(context, redis));
	app.get('/api/users/:id/tokens', (context) => handleListUserTokens(context, redis));
	app.delete('/api/users/:id/tokens/:tokenId', (context) => handleRevokeUserToken(context, redis));

	// User API key management
	app.get('/api/users/me/api-keys', (context) => handleListApiKeys(context, redis));
	app.post('/api/users/me/api-keys', (context) => handleCreateApiKey(context, redis));
	app.post('/api/users/me/api-keys/validate', (context) => handlePreValidateApiKey(context, redis));
	app.delete('/api/users/me/api-keys/:provider', (context) => handleDeleteApiKey(context, redis));
	app.post('/api/users/me/api-keys/:provider/validate', (context) => handleValidateApiKey(context, redis));

	// Project routes. Every route under /api/projects/:owner/:project declares the least
	// role it needs (docs/specs/multi-user-collaboration.md, Roles and Permissions); the
	// role-matrix suite fails any that doesn't.
	const requireProjectAccess = projectAccessGate(redis);
	const viewer = requireProjectAccess('viewer');
	const editor = requireProjectAccess('editor');
	const owner = requireProjectAccess('owner');

	app.get('/api/projects', (context) => handleListProjects(context, redis));
	app.post('/api/projects', (context) => handleCreateProject(context, redis));
	app.get('/api/projects/:owner/:project', viewer, handleGetProject);
	app.put('/api/projects/:owner/:project', owner, handleUpdateProject);
	app.delete('/api/projects/:owner/:project', owner, handleDeleteProject);

	// Members. Leaving removes the caller's own membership, on a path no member slug can collide with.
	app.get('/api/projects/:owner/:project/members', viewer, handleListMembers);
	app.put('/api/projects/:owner/:project/members/:member', owner, handleUpdateMember);
	app.delete('/api/projects/:owner/:project/members/:member', owner, handleRemoveMember);
	app.delete('/api/projects/:owner/:project/membership', viewer, handleLeaveProject);

	// Invitations, the owner's side. The pending list carries invitees' addresses, so it is owner-only too.
	app.post('/api/projects/:owner/:project/invitations', owner, (context) => handleCreateInvitation(context, redis));
	app.get('/api/projects/:owner/:project/invitations', owner, handleListInvitations);
	app.post('/api/projects/:owner/:project/invitations/:invitation/resend', owner, (context) => handleResendInvitation(context, redis));
	app.delete('/api/projects/:owner/:project/invitations/:invitation', owner, handleRevokeInvitation);

	// Invitations, the invitee's side: not project routes, since the caller isn't a member yet.
	// Each answer checks the invitation is addressed to the signed-in account. The /invite
	// page goes by the emailed token; the projects list goes by id.
	app.get('/api/invite', (context) => handleLookupInvite(context, redis));
	app.post('/api/invite/accept', (context) => handleAcceptInvite(context, redis));
	app.post('/api/invite/decline', (context) => handleDeclineInvite(context, redis));
	app.get('/api/invitations', (context) => handleListMyInvitations(context, redis));
	app.post('/api/invitations/:id/accept', (context) => handleAcceptMyInvitation(context, redis));
	app.post('/api/invitations/:id/decline', (context) => handleDeclineMyInvitation(context, redis));

	// Local folders. Adding one stats an arbitrary path on the API host and runs git there, so
	// the route only exists where a repository is mounted (dev compose). Removing one is a
	// plain DB write.
	app.delete('/api/projects/:owner/:project/folders', owner, handleRemoveFolder);
	if (process.env.LOCAL_STORAGE_ENABLED === 'true') {
		app.post('/api/projects/:owner/:project/folders', owner, handleAddFolder);
	}

	// Project files
	app.get('/api/projects/:owner/:project/tree', viewer, handleListFiles);
	app.post('/api/projects/:owner/:project/tree', viewer, handleListFiles);
	app.get('/api/projects/:owner/:project/files', viewer, handleReadFile);
	app.post('/api/projects/:owner/:project/files', editor, (context) => handleCreateFile(context, redis));
	app.put('/api/projects/:owner/:project/files', editor, (context) => handleWriteFile(context, redis));
	app.put('/api/projects/:owner/:project/files/rename', editor, (context) => handleRenameFile(context, redis));
	app.delete('/api/projects/:owner/:project/files', editor, (context) => handleDeleteFile(context, redis));

	// Project version-control routes (local mode; commit and pull hand cloud projects to the GitHub handlers)
	app.get('/api/projects/:owner/:project/git/status', viewer, handleGetGitStatus);
	app.post('/api/projects/:owner/:project/git/commit', editor, handleCommit);
	app.post('/api/projects/:owner/:project/git/restore', editor, (context) => handleRestore(context, redis));
	app.post('/api/projects/:owner/:project/git/pull', editor, (context) => handlePull(context, redis));

	// GitHub sync routes (cloud mode). Syncs and commits run on the caller's own GitHub token.
	app.post('/api/projects/:owner/:project/sync', editor, handleGitHubSync);
	app.post('/api/projects/:owner/:project/sync/initial', editor, handleGitHubInitialSync);
	app.get('/api/projects/:owner/:project/sync/status', viewer, handleGitHubSyncStatus);
	app.post('/api/projects/:owner/:project/github/commit', editor, handleGitHubCommit);

	// AI chat over the project's documents
	app.post('/api/projects/:owner/:project/chat', viewer, (context) => handleChat(context, redis));

	registerPlanningRoutes(app, { redis });

	// AI chat model catalog (not project-scoped)
	app.get('/api/chat/models', (context) => handleGetChatModels(context, redis));
	app.get('/api/chat/providers', (context) => handleGetChatProviders(context, redis));

	return app;
}
