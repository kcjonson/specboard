/**
 * Frontend server
 * Serves static SPA files with authentication
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { authMiddleware, type AuthVariables } from '@doc-platform/auth';
import { renderLoginPage } from './pages/login.js';
import { renderSignupPage } from './pages/signup.js';

const app = new Hono<{ Variables: AuthVariables }>();

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (err) => {
	console.error('Redis connection error:', err);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

// Health check (no auth required)
app.get('/health', (c) => c.json({ status: 'ok' }));

// Login page (no auth required)
app.get('/login', (c) => {
	return c.html(renderLoginPage());
});

// Signup page (no auth required)
app.get('/signup', (c) => {
	return c.html(renderSignupPage());
});

// Auth middleware for all other routes
app.use(
	'*',
	authMiddleware(redis, {
		excludePaths: ['/health', '/login', '/signup'],
		onUnauthenticated: () => {
			return Response.redirect('/login', 302);
		},
	})
);

// Serve static files from /static directory
// In production, this will be the built SPA
app.use(
	'/*',
	serveStatic({
		root: './static',
		onNotFound: (path) => {
			// For non-file requests (no extension), fall through to SPA handler
			if (!path.includes('.')) {
				return;
			}
		},
	})
);

// SPA fallback - serve index.html for all non-file routes
app.get('*', async (c) => {
	const path = new URL(c.req.url).pathname;

	// If it looks like a file request, return 404
	if (path.includes('.')) {
		return c.notFound();
	}

	// Serve index.html for SPA routing
	const fs = await import('node:fs/promises');
	try {
		const html = await fs.readFile('./static/index.html', 'utf-8');
		return c.html(html);
	} catch {
		return c.notFound();
	}
});

// Start server
const PORT = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`Frontend server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
	console.log('Shutting down...');
	await redis.quit();
	process.exit(0);
});
