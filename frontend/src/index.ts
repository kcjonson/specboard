/**
 * Frontend server
 * Serves static SPA files with authentication
 */

import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { authMiddleware, type AuthVariables } from '@doc-platform/auth';
import { renderLoginPage } from './pages/login.js';
import { renderSignupPage } from './pages/signup.js';
import { renderNotFoundPage } from './pages/not-found.js';

// Load Vite manifest for asset paths
interface ManifestEntry {
	file: string;
	css?: string[];
}
type Manifest = Record<string, ManifestEntry>;

let manifest: Manifest = {};
try {
	const manifestPath = './static/.vite/manifest.json';
	manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch {
	console.warn('Vite manifest not found - CSS paths will be unavailable');
}

// Get CSS paths from manifest
// When CSS files are used as entry points, the 'file' property contains the CSS path directly
function getCssPath(entry: string): string | undefined {
	const manifestEntry = manifest[entry];
	if (manifestEntry?.file) {
		return '/' + manifestEntry.file;
	}
	return undefined;
}

const sharedCssPath = getCssPath('../shared/ui/src/shared.css');
const loginCssPath = getCssPath('../frontend/src/styles/login.css');
const signupCssPath = getCssPath('../frontend/src/styles/signup.css');
const notFoundCssPath = getCssPath('../frontend/src/styles/not-found.css');

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
	return c.html(renderLoginPage({
		sharedCssPath,
		loginCssPath,
	}));
});

// Signup page (no auth required)
app.get('/signup', (c) => {
	return c.html(renderSignupPage({
		sharedCssPath,
		signupCssPath,
	}));
});

// API URL for proxying
const apiUrl = process.env.API_URL || 'http://localhost:3001';

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

// Auth middleware for all other routes
app.use(
	'*',
	authMiddleware(redis, {
		excludePaths: ['/health', '/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/logout', '/api/auth/me', sharedCssPath, loginCssPath, signupCssPath, notFoundCssPath].filter(Boolean) as string[],
		onUnauthenticated: (requestUrl) => {
			// Redirect to login with return URL preserved
			const loginUrl = new URL('/login', requestUrl.origin);
			// Only add next param for non-root paths
			if (requestUrl.pathname !== '/') {
				loginUrl.searchParams.set('next', requestUrl.pathname + requestUrl.search);
			}
			return Response.redirect(loginUrl.toString(), 302);
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

// Custom 404 handler - friendly page for all not found requests
app.notFound((c) => {
	return c.html(renderNotFoundPage({
		sharedCssPath,
		notFoundCssPath,
	}), 404);
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
