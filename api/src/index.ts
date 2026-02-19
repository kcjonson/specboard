/**
 * @doc-platform/api
 * Backend API server using Hono.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';

import {
	rateLimitMiddleware,
	csrfMiddleware,
	RATE_LIMIT_CONFIGS,
	getSession,
	SESSION_COOKIE_NAME,
} from '@doc-platform/auth';
import { reportError, installErrorHandlers, logRequest } from '@doc-platform/core';
import { getCookie } from 'hono/cookie';

// Context variables for request tracking
type AppVariables = {
	userId: string | undefined;
};

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
	handleListEpics,
	handleGetEpic,
	handleCreateEpic,
	handleUpdateEpic,
	handleDeleteEpic,
	handleGetCurrentWork,
	handleSignalReadyForReview,
} from './handlers/epics.ts';
import {
	handleListTasks,
	handleCreateTask,
	handleUpdateTask,
	handleDeleteTask,
	handleBulkCreateTasks,
	handleStartTask,
	handleCompleteTask,
	handleBlockTask,
	handleUnblockTask,
} from './handlers/tasks.ts';
import {
	handleListEpicProgress,
	handleCreateEpicProgress,
	handleListTaskProgress,
	handleCreateTaskProgress,
} from './handlers/progress.ts';
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

// Install global error handlers for uncaught exceptions
installErrorHandlers('api');

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (error) => {
	console.error('Redis connection error:', error);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

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

// App
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
	exposeHeaders: ['Location'], // Allow browser to read Location header for OAuth redirects
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
		const session = await getSession(redis, sessionId);
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
			{ path: '/api/auth/forgot-password', config: RATE_LIMIT_CONFIGS.forgot },
			{ path: '/api/auth/resend-verification', config: RATE_LIMIT_CONFIGS.resendVerification },
			{ path: '/api/auth/github', config: RATE_LIMIT_CONFIGS.login }, // OAuth start - same limit as login
			{ path: '/oauth/token', config: RATE_LIMIT_CONFIGS.oauthToken },
			{ path: '/oauth/authorize', config: RATE_LIMIT_CONFIGS.oauthAuthorize },
			{ path: '/oauth/register', config: RATE_LIMIT_CONFIGS.oauthToken }, // Same limit as token endpoint
			{ path: '/api/chat', config: RATE_LIMIT_CONFIGS.chat },
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

		// Get user context from session (if logged in)
		let userId: string | undefined;
		const sessionId = getCookie(context, SESSION_COOKIE_NAME);
		if (sessionId) {
			const session = await getSession(redis, sessionId);
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
app.post('/api/auth/signup', handleSignup);
app.post('/api/auth/logout', (context) => handleLogout(context, redis));
app.get('/api/auth/me', (context) => handleGetMe(context, redis));
app.put('/api/auth/me', (context) => handleUpdateMe(context, redis));

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

// Project routes
app.get('/api/projects', (context) => handleListProjects(context, redis));
app.get('/api/projects/:id', (context) => handleGetProject(context, redis));
app.post('/api/projects', (context) => handleCreateProject(context, redis));
app.put('/api/projects/:id', (context) => handleUpdateProject(context, redis));
app.delete('/api/projects/:id', (context) => handleDeleteProject(context, redis));

// Project storage routes (folders, files)
app.post('/api/projects/:id/folders', (context) => handleAddFolder(context, redis));
app.delete('/api/projects/:id/folders', (context) => handleRemoveFolder(context, redis));
app.get('/api/projects/:id/tree', (context) => handleListFiles(context, redis));
app.post('/api/projects/:id/tree', (context) => handleListFiles(context, redis));
app.get('/api/projects/:id/files', (context) => handleReadFile(context, redis));
app.post('/api/projects/:id/files', (context) => handleCreateFile(context, redis));
app.put('/api/projects/:id/files', (context) => handleWriteFile(context, redis));
app.put('/api/projects/:id/files/rename', (context) => handleRenameFile(context, redis));
app.delete('/api/projects/:id/files', (context) => handleDeleteFile(context, redis));

// Project git routes (local mode)
app.get('/api/projects/:id/git/status', (context) => handleGetGitStatus(context, redis));
app.post('/api/projects/:id/git/commit', (context) => handleCommit(context, redis));
app.post('/api/projects/:id/git/restore', (context) => handleRestore(context, redis));
app.post('/api/projects/:id/git/pull', (context) => handlePull(context, redis));

// GitHub sync routes (cloud mode)
app.post('/api/projects/:id/sync', (context) => handleGitHubSync(context, redis));
app.post('/api/projects/:id/sync/initial', (context) => handleGitHubInitialSync(context, redis));
app.get('/api/projects/:id/sync/status', (context) => handleGitHubSyncStatus(context, redis));
app.post('/api/projects/:id/github/commit', (context) => handleGitHubCommit(context, redis));

// Project-scoped epic routes
app.get('/api/projects/:projectId/epics', handleListEpics);
app.get('/api/projects/:projectId/epics/current', handleGetCurrentWork);
app.get('/api/projects/:projectId/epics/:id', handleGetEpic);
app.post('/api/projects/:projectId/epics', handleCreateEpic);
app.put('/api/projects/:projectId/epics/:id', handleUpdateEpic);
app.delete('/api/projects/:projectId/epics/:id', handleDeleteEpic);
app.post('/api/projects/:projectId/epics/:id/ready-for-review', handleSignalReadyForReview);

// Project-scoped task routes
app.get('/api/projects/:projectId/epics/:epicId/tasks', handleListTasks);
app.post('/api/projects/:projectId/epics/:epicId/tasks', handleCreateTask);
app.post('/api/projects/:projectId/epics/:epicId/tasks/bulk', handleBulkCreateTasks);
app.put('/api/projects/:projectId/tasks/:id', handleUpdateTask);
app.delete('/api/projects/:projectId/tasks/:id', handleDeleteTask);
app.post('/api/projects/:projectId/tasks/:id/start', handleStartTask);
app.post('/api/projects/:projectId/tasks/:id/complete', handleCompleteTask);
app.post('/api/projects/:projectId/tasks/:id/block', handleBlockTask);
app.post('/api/projects/:projectId/tasks/:id/unblock', handleUnblockTask);

// Project-scoped progress notes routes
app.get('/api/projects/:projectId/epics/:epicId/progress', handleListEpicProgress);
app.post('/api/projects/:projectId/epics/:epicId/progress', handleCreateEpicProgress);
app.get('/api/projects/:projectId/tasks/:taskId/progress', handleListTaskProgress);
app.post('/api/projects/:projectId/tasks/:taskId/progress', handleCreateTaskProgress);

// AI Chat
app.get('/api/chat/models', (context) => handleGetChatModels(context, redis));
app.get('/api/chat/providers', (context) => handleGetChatProviders(context, redis));
app.post('/api/chat', (context) => handleChat(context, redis));

// Start server
const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`API server running on http://localhost:${PORT}`);
});
