/**
 * Frontend server
 * Serves static SPA files with authentication
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { authMiddleware, type AuthVariables } from '@doc-platform/auth';

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

// Auth middleware for all other routes
app.use(
	'*',
	authMiddleware(redis, {
		excludePaths: ['/health', '/login', '/login.html'],
		onUnauthenticated: () => {
			// Redirect to login page (served by API or external)
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
		// Fallback to index.html for SPA routing
		onNotFound: (path) => {
			// For non-file requests (no extension), serve index.html
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
