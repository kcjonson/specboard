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
} from '@doc-platform/auth';

import { handleLogin, handleLogout, handleGetMe, handleUpdateMe, handleSignup } from './handlers/auth.js';
import {
	handleOAuthMetadata,
	handleAuthorizeGet,
	handleAuthorizePost,
	handleToken,
	handleRevoke,
	handleListAuthorizations,
	handleDeleteAuthorization,
} from './handlers/oauth.js';
import {
	handleListEpics,
	handleGetEpic,
	handleCreateEpic,
	handleUpdateEpic,
	handleDeleteEpic,
	handleGetCurrentWork,
	handleSignalReadyForReview,
} from './handlers/epics.js';
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
} from './handlers/tasks.js';
import {
	handleListEpicProgress,
	handleCreateEpicProgress,
	handleListTaskProgress,
	handleCreateTaskProgress,
} from './handlers/progress.js';
import {
	handleListProjects,
	handleGetProject,
	handleCreateProject,
	handleUpdateProject,
	handleDeleteProject,
} from './handlers/projects.js';

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (error) => {
	console.error('Redis connection error:', error);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

// App
const app = new Hono();

// Middleware
app.use('*', cors());

// Rate limiting middleware (per spec requirements)
app.use(
	'*',
	rateLimitMiddleware(redis, {
		rules: [
			{ path: '/api/auth/login', config: RATE_LIMIT_CONFIGS.login },
			{ path: '/api/auth/signup', config: RATE_LIMIT_CONFIGS.signup },
			{ path: '/oauth/token', config: RATE_LIMIT_CONFIGS.oauthToken },
			{ path: '/oauth/authorize', config: RATE_LIMIT_CONFIGS.oauthAuthorize },
		],
		defaultLimit: RATE_LIMIT_CONFIGS.api,
		excludePaths: ['/health', '/api/health'],
	})
);

// CSRF protection for state-changing requests
// Excludes login/signup (no session yet), logout (low-impact if CSRF'd)
// Excludes OAuth token/revoke endpoints (use PKCE instead)
app.use(
	'*',
	csrfMiddleware(redis, {
		excludePaths: [
			'/api/auth/login',
			'/api/auth/signup',
			'/api/auth/logout',
			'/oauth/token',
			'/oauth/revoke',
			'/.well-known/oauth-authorization-server',
			'/health',
			'/api/health',
		],
	})
);

// Health check
app.get('/health', (context) => context.json({ status: 'ok' }));
app.get('/api/health', (context) => context.json({ status: 'ok' }));

// Auth routes
app.post('/api/auth/login', (context) => handleLogin(context, redis));
app.post('/api/auth/signup', (context) => handleSignup(context, redis));
app.post('/api/auth/logout', (context) => handleLogout(context, redis));
app.get('/api/auth/me', (context) => handleGetMe(context, redis));
app.put('/api/auth/me', (context) => handleUpdateMe(context, redis));

// OAuth 2.1 routes (MCP authentication)
app.get('/.well-known/oauth-authorization-server', handleOAuthMetadata);
app.get('/oauth/authorize', (context) => handleAuthorizeGet(context, redis));
app.post('/oauth/authorize', (context) => handleAuthorizePost(context, redis));
app.post('/oauth/token', handleToken);
app.post('/oauth/revoke', handleRevoke);

// OAuth authorization management (user settings)
app.get('/api/oauth/authorizations', (context) => handleListAuthorizations(context, redis));
app.delete('/api/oauth/authorizations/:id', (context) => handleDeleteAuthorization(context, redis));

// Project routes (user-scoped, not project-scoped)
app.get('/api/projects', (context) => handleListProjects(context, redis));
app.get('/api/projects/:id', (context) => handleGetProject(context, redis));
app.post('/api/projects', (context) => handleCreateProject(context, redis));
app.put('/api/projects/:id', (context) => handleUpdateProject(context, redis));
app.delete('/api/projects/:id', (context) => handleDeleteProject(context, redis));

// Project routes (user-scoped, not project-scoped)
app.get('/api/projects', (context) => handleListProjects(context, redis));
app.get('/api/projects/:id', (context) => handleGetProject(context, redis));
app.post('/api/projects', (context) => handleCreateProject(context, redis));
app.put('/api/projects/:id', (context) => handleUpdateProject(context, redis));
app.delete('/api/projects/:id', (context) => handleDeleteProject(context, redis));

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

// Start server
const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`API server running on http://localhost:${PORT}`);
});
