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

// Proxy auth requests to API
const apiUrl = process.env.API_URL || 'http://localhost:3001';

app.post('/auth/login', async (c) => {
	const body = await c.req.json();
	const response = await fetch(`${apiUrl}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const data = await response.json();

	// Forward the response including Set-Cookie header
	const result = c.json(data, response.status as 200 | 401 | 400);

	// Copy session cookie from API response
	const setCookieHeader = response.headers.get('Set-Cookie');
	if (setCookieHeader) {
		result.headers.set('Set-Cookie', setCookieHeader);
	}

	return result;
});

app.post('/auth/logout', async (c) => {
	const cookie = c.req.header('Cookie') || '';
	const response = await fetch(`${apiUrl}/auth/logout`, {
		method: 'POST',
		headers: { Cookie: cookie },
	});

	const data = await response.json();
	const result = c.json(data, response.status as 200);

	// Copy Set-Cookie header to clear the cookie
	const setCookieHeader = response.headers.get('Set-Cookie');
	if (setCookieHeader) {
		result.headers.set('Set-Cookie', setCookieHeader);
	}

	return result;
});

app.get('/auth/me', async (c) => {
	const cookie = c.req.header('Cookie') || '';
	const response = await fetch(`${apiUrl}/auth/me`, {
		headers: { Cookie: cookie },
	});

	const data = await response.json();
	return c.json(data, response.status as 200 | 401);
});

// Auth middleware for all other routes
app.use(
	'*',
	authMiddleware(redis, {
		excludePaths: ['/health', '/login', '/auth/login', '/auth/logout', '/auth/me'],
		onUnauthenticated: (_path) => {
			// Build absolute URL for redirect
			const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
			return Response.redirect(new URL('/login', baseUrl).toString(), 302);
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
