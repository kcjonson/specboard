/**
 * Frontend server
 * Serves static SPA files with authentication
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Redis } from 'ioredis';
import { authMiddleware, type AuthVariables } from '@specboard/auth';
import { reportError, installErrorHandlers, logRequest } from '@specboard/core';
import { pages, spaIndex, type CachedPage } from './static-pages.ts';

// Vite dev server URL for hot reloading (set in docker-compose for dev mode)
const VITE_DEV_SERVER = process.env.VITE_DEV_SERVER;

const app = new Hono<{ Variables: AuthVariables }>();

/**
 * Proxy a request to the Vite dev server for HMR support.
 * Used in development mode to serve the SPA with hot module replacement.
 */
async function proxyToVite(c: Context, path: string): Promise<Response> {
	if (!VITE_DEV_SERVER) {
		throw new Error('VITE_DEV_SERVER not configured');
	}

	try {
		const viteUrl = `${VITE_DEV_SERVER}${path}`;
		const response = await fetch(viteUrl, {
			method: c.req.method,
			headers: {
				'Accept': c.req.header('Accept') || '*/*',
				'Accept-Encoding': c.req.header('Accept-Encoding') || '',
			},
		});

		// Forward the response with appropriate headers
		return new Response(response.body, {
			status: response.status,
			headers: {
				'Content-Type': response.headers.get('Content-Type') || 'text/html',
				'Cache-Control': 'no-cache',
			},
		});
	} catch (error) {
		console.error('Vite proxy error:', error);
		// Return a helpful error page instead of crashing
		const message = error instanceof Error ? error.message : 'Unknown error';
		return new Response(
			`<html><body><h1>Vite Dev Server Unavailable</h1><p>${message}</p><p>Ensure Vite is running on ${VITE_DEV_SERVER}</p></body></html>`,
			{ status: 502, headers: { 'Content-Type': 'text/html' } }
		);
	}
}

/**
 * Serve a cached SSG page with preload headers.
 * SPA index uses private caching to avoid cache poisoning between auth states.
 * In dev mode, skip preload headers since production CSS paths don't exist.
 */
function servePage(c: Context, page: CachedPage, status: ContentfulStatusCode = 200): Response {
	const isSpaIndex = page === spaIndex;
	const cacheControl = isSpaIndex
		? 'private, no-cache, no-store, must-revalidate'
		: 'public, max-age=3600';

	const headers: Record<string, string> = {
		'Cache-Control': cacheControl,
	};

	// Only send preload headers in production - dev mode uses Vite-served source CSS
	if (!VITE_DEV_SERVER && page.preloadHeader) {
		headers['Link'] = page.preloadHeader;
	}

	return c.html(page.html, status, headers);
}

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (err) => {
	console.error('Redis connection error:', err);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

// Install global error handlers for uncaught exceptions
installErrorHandlers('frontend');

// Request logging middleware
// Logs all requests in Combined Log Format style for CloudWatch Logs Insights queries
// Note: await next() never throws in Hono - errors are caught internally and passed to app.onError()
app.use('*', async (c, next) => {
	const start = Date.now();

	await next();

	// Get userId from auth middleware context (set for authenticated routes, undefined for public routes)
	const user = c.get('user');

	// Log the request (runs for both success and error responses)
	const duration = Date.now() - start;
	logRequest({
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration,
		ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
		userAgent: c.req.header('user-agent'),
		referer: c.req.header('referer'),
		userId: user?.id,
		contentLength: parseInt(c.res.headers.get('content-length') || '0', 10),
	});
});

// Health check (no auth required)
app.get('/health', (c) => c.json({ status: 'ok' }));

// Login page (no auth required)
app.get('/login', (c) => servePage(c, pages.login));

// Signup page (no auth required)
app.get('/signup', (c) => servePage(c, pages.signup));

// Email verification pages (no auth required)
app.get('/verify-email', (c) => servePage(c, pages.verifyEmail));
app.get('/verify-email/confirm', (c) => servePage(c, pages.verifyEmailConfirm));

// Password reset pages (no auth required)
app.get('/forgot-password', (c) => servePage(c, pages.forgotPassword));
app.get('/reset-password', (c) => servePage(c, pages.resetPassword));

// Marketing home page - always accessible (even when authenticated)
app.get('/home', (c) => servePage(c, pages.home));

// Root - marketing for unauthenticated, SPA for authenticated
app.get('/', async (c) => {
	// Check for session cookie (cookie name is 'session_id')
	const cookieHeader = c.req.header('Cookie') || '';
	const sessionMatch = cookieHeader.match(/session_id=([^;]+)/);
	const sessionId = sessionMatch?.[1];

	if (sessionId) {
		// Verify session exists in Redis
		const sessionData = await redis.get(`session:${sessionId}`);
		if (sessionData) {
			// Authenticated - serve SPA
			if (VITE_DEV_SERVER) {
				// Dev mode: proxy to Vite for HMR
				return proxyToVite(c, '/');
			}
			// Production: serve cached SPA
			return servePage(c, spaIndex);
		}
	}

	// Unauthenticated - serve marketing home page
	return servePage(c, pages.home);
});

// API URL for proxying
const apiUrl = process.env.API_URL || 'http://localhost:3001';

// =============================================================================
// OAuth Proxy Routes (for local development only)
// =============================================================================
// In production/docker-compose: nginx routes /oauth/* directly to API service
// In local development: these proxy routes forward OAuth requests to the API
// This allows running `npm run dev` without needing the full docker-compose stack
// =============================================================================

// Proxy OAuth authorize POST to API (form submission)
app.post('/oauth/authorize', async (c) => {
	const cookie = c.req.header('Cookie') || '';
	const contentType = c.req.header('Content-Type') || '';

	let body: string;
	if (contentType.includes('application/x-www-form-urlencoded')) {
		const formData = await c.req.parseBody();
		body = new URLSearchParams(formData as Record<string, string>).toString();
	} else {
		body = await c.req.text();
	}

	try {
		const response = await fetch(`${apiUrl}/oauth/authorize`, {
			method: 'POST',
			headers: {
				Cookie: cookie,
				'Content-Type': contentType,
			},
			body,
			redirect: 'manual', // Don't follow redirects
		});

		// Forward redirect response
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('Location');
			if (location) {
				return c.redirect(location);
			}
		}

		// Forward other responses
		const data = await response.text();
		return new Response(data, {
			status: response.status,
			headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
		});
	} catch {
		return c.json({ error: 'server_error', error_description: 'Authorization service unavailable' }, 503);
	}
});

// Proxy OAuth token endpoint to API
app.post('/oauth/token', async (c) => {
	const contentType = c.req.header('Content-Type') || '';
	const body = await c.req.text();

	try {
		const response = await fetch(`${apiUrl}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body,
		});

		const data = await response.json();
		const status = response.status === 200 ? 200 : 400;
		return c.json(data, status);
	} catch {
		return c.json({ error: 'server_error', error_description: 'API unavailable' }, 503);
	}
});

// Proxy OAuth revoke endpoint to API
app.post('/oauth/revoke', async (c) => {
	const contentType = c.req.header('Content-Type') || '';
	const body = await c.req.text();

	try {
		const response = await fetch(`${apiUrl}/oauth/revoke`, {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body,
		});

		const data = await response.json();
		const status = response.status === 200 ? 200 : 400;
		return c.json(data, status);
	} catch {
		return c.json({ error: 'server_error', error_description: 'API unavailable' }, 503);
	}
});

// Proxy OAuth metadata endpoint to API
app.get('/.well-known/oauth-authorization-server', async (c) => {
	try {
		const response = await fetch(`${apiUrl}/.well-known/oauth-authorization-server`);
		const data = await response.json();
		return c.json(data);
	} catch {
		return c.json({ error: 'server_error', error_description: 'API unavailable' }, 503);
	}
});

// Proxy OAuth authorizations API to backend
app.get('/api/oauth/authorizations', async (c) => {
	const cookie = c.req.header('Cookie') || '';
	try {
		const response = await fetch(`${apiUrl}/api/oauth/authorizations`, {
			headers: { Cookie: cookie },
		});
		const data = await response.json();
		const status = response.status === 200 ? 200 : 401;
		return c.json(data, status);
	} catch {
		return c.json({ error: 'API unavailable' }, 503);
	}
});

app.delete('/api/oauth/authorizations/:id', async (c) => {
	const id = c.req.param('id');
	const cookie = c.req.header('Cookie') || '';
	const csrfToken = c.req.header('X-CSRF-Token') || '';

	try {
		const response = await fetch(`${apiUrl}/api/oauth/authorizations/${id}`, {
			method: 'DELETE',
			headers: {
				Cookie: cookie,
				'X-CSRF-Token': csrfToken,
			},
		});

		if (response.status === 204) {
			return new Response(null, { status: 204 });
		}
		const data = await response.json();
		const status = response.status === 401 ? 401 : 404;
		return c.json(data, status);
	} catch {
		return c.json({ error: 'API unavailable' }, 503);
	}
});

// Proxy auth requests to API
app.post('/api/auth/login', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON' }, 400);
	}

	try {
		const response = await fetch(`${apiUrl}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		const data = await response.json();

		// Forward the response including Set-Cookie header
		const status = response.status === 200 ? 200 : response.status === 401 ? 401 : 400;
		const result = c.json(data, status);

		// Copy session cookie from API response
		const setCookieHeader = response.headers.get('Set-Cookie');
		if (setCookieHeader) {
			result.headers.set('Set-Cookie', setCookieHeader);
		}

		return result;
	} catch {
		return c.json({ error: 'Authentication service unavailable' }, 503);
	}
});

app.post('/api/auth/signup', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON' }, 400);
	}

	try {
		const response = await fetch(`${apiUrl}/api/auth/signup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		const data = await response.json();

		// Forward the response including Set-Cookie header
		const status = response.status === 201 ? 201 : response.status === 409 ? 409 : response.status === 500 ? 500 : 400;
		const result = c.json(data, status);

		// Copy session cookie from API response (user is logged in after signup)
		const setCookieHeader = response.headers.get('Set-Cookie');
		if (setCookieHeader) {
			result.headers.set('Set-Cookie', setCookieHeader);
		}

		return result;
	} catch {
		return c.json({ error: 'Signup service unavailable' }, 503);
	}
});

app.post('/api/auth/logout', async (c) => {
	const cookie = c.req.header('Cookie') || '';

	try {
		const response = await fetch(`${apiUrl}/api/auth/logout`, {
			method: 'POST',
			headers: { Cookie: cookie },
		});

		const data = await response.json();
		const result = c.json(data, 200);

		// Copy Set-Cookie header to clear the cookie
		const setCookieHeader = response.headers.get('Set-Cookie');
		if (setCookieHeader) {
			result.headers.set('Set-Cookie', setCookieHeader);
		}

		return result;
	} catch {
		return c.json({ error: 'Logout service unavailable' }, 503);
	}
});

app.get('/api/auth/me', async (c) => {
	const cookie = c.req.header('Cookie') || '';

	try {
		const response = await fetch(`${apiUrl}/api/auth/me`, {
			headers: { Cookie: cookie },
		});

		const data = await response.json();
		const status = response.status === 200 ? 200 : 401;
		return c.json(data, status);
	} catch {
		return c.json({ error: 'Authentication service unavailable' }, 503);
	}
});

// Serve SSG assets (CSS for login, signup, home, 404) without auth
// These must be accessible for unauthenticated pages to render correctly
// CSS paths are /assets/styles/common-HASH.css and /assets/styles/ssg/NAME-HASH.css
app.use(
	'/assets/styles/*',
	serveStatic({
		root: './static',
	})
);

// Serve public static files without auth (favicon, robots.txt, version.txt)
app.get('/favicon.svg', serveStatic({ root: './static', path: 'favicon.svg' }));
app.get('/robots.txt', serveStatic({ root: './static', path: 'robots.txt' }));
app.get('/version.txt', serveStatic({ root: './static', path: 'version.txt' }));

// Auth middleware for all other routes
// Unauthenticated users see 404 for any non-public path
// They can find login from the 404 page or by going to /
app.use(
	'*',
	authMiddleware(redis, {
		excludePaths: ['/health', '/login', '/signup', '/home', '/api/auth/login', '/api/auth/signup', '/api/auth/logout', '/api/auth/me'],
		onUnauthenticated: () => {
			// Show 404 for unauthenticated requests
			// This avoids revealing which routes exist and eliminates route duplication
			const headers: Record<string, string> = {
				'Content-Type': 'text/html; charset=UTF-8',
				'Cache-Control': 'public, max-age=3600',
			};
			// Only send preload headers in production
			if (!VITE_DEV_SERVER && pages.notFound.preloadHeader) {
				headers['Link'] = pages.notFound.preloadHeader;
			}
			return new Response(pages.notFound.html, { status: 404, headers });
		},
	})
);

// Serve remaining static files (SPA bundle, etc.) - requires auth
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

	// Dev mode: proxy to Vite for HMR
	if (VITE_DEV_SERVER) {
		return proxyToVite(c, path);
	}

	// Production: serve cached SPA
	return servePage(c, spaIndex);
});

// Custom 404 handler - friendly page for all not found requests
app.notFound((c) => servePage(c, pages.notFound, 404));

app.onError((error, c) => {
	// Report error to error tracking service
	const user = c.get('user');
	reportError({
		name: error.name,
		message: error.message,
		stack: error.stack,
		timestamp: Date.now(),
		url: c.req.url,
		userAgent: c.req.header('user-agent'),
		userId: user?.id,
		source: 'frontend',
		environment: process.env.NODE_ENV,
		extra: {
			method: c.req.method,
			path: c.req.path,
		},
	}).catch(() => {
		// Don't let error reporting failure affect the response
	});

	console.error('Unhandled error:', error);
	return c.html(pages.notFound.html, 500);
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
