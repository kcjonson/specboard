/**
 * @doc-platform/storage
 * Internal storage service - dumb filesystem API for S3 + Postgres.
 * No user auth - validated by main API before calling.
 */

import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { Context, Next } from 'hono';

import { apiKeyAuth } from './middleware/auth.ts';
import { filesRoutes } from './handlers/files.ts';
import { pendingRoutes } from './handlers/pending.ts';
import { initDb, closeDb } from './db/index.ts';
import { runMigrations } from './db/migrate.ts';

// Request size limit: 50MB max
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024;

// Rate limiting: 1000 requests per minute per API key
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 1000;

// In-memory rate limit store
// TODO: Move to Redis for multi-instance deployments. Current in-memory approach
// means each ECS task has its own rate limit counter. For production scale,
// use Redis INCR with EXPIRE for shared, atomic rate limiting.
interface RateLimitEntry {
	count: number;
	resetAt: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Middleware to enforce request size limit based on Content-Length header.
 */
async function requestSizeLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
	const contentLength = c.req.header('content-length');
	if (contentLength) {
		const size = Number(contentLength);
		if (!Number.isNaN(size) && size > MAX_CONTENT_LENGTH) {
			return c.json({ error: 'Payload too large' }, 413);
		}
	}
	await next();
}

/**
 * Middleware to apply per-API-key rate limiting.
 */
async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
	const apiKey = c.req.header('x-internal-api-key') || 'anonymous';
	const now = Date.now();

	const existing = rateLimitStore.get(apiKey);
	if (!existing || now > existing.resetAt) {
		rateLimitStore.set(apiKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
		await next();
		return;
	}

	if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
		const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
		c.header('Retry-After', String(Math.max(retryAfter, 1)));
		return c.json({ error: 'Too many requests' }, 429);
	}

	existing.count++;
	await next();
}

const app = new Hono();

// Health check (no auth required)
app.get('/health', (c) => c.json({ status: 'ok' }));

// Request size limits (before auth to reject early)
app.use('*', requestSizeLimitMiddleware);

// All other routes require internal API key
app.use('*', apiKeyAuth);

// Rate limiting (after auth so we can rate limit per API key)
app.use('*', rateLimitMiddleware);

// Mount route handlers
app.route('/files', filesRoutes);
app.route('/pending', pendingRoutes);

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((error, c) => {
	console.error('Unhandled error:', error);
	return c.json({ error: 'Internal server error' }, 500);
});

// Start server
const PORT = Number(process.env.PORT) || 3003;

// Server instance for graceful shutdown
let server: ServerType | null = null;

/**
 * Graceful shutdown handler.
 * Stops accepting new connections, then closes database pool.
 */
async function shutdown(): Promise<void> {
	console.log('Shutting down gracefully...');

	// Stop accepting new connections
	if (server) {
		await new Promise<void>((resolve) => {
			server!.close(() => {
				console.log('HTTP server closed');
				resolve();
			});
		});
	}

	// Close database connections
	await closeDb();
	console.log('Database connections closed');

	process.exit(0);
}

async function start(): Promise<void> {
	// Register shutdown handlers BEFORE migrations
	// so we can handle interrupts during startup
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	// Run migrations first
	console.log('Running migrations...');
	await runMigrations();

	// Initialize database pool for request handling
	initDb();

	server = serve({ fetch: app.fetch, port: PORT }, () => {
		console.log(`Storage service running on http://localhost:${PORT}`);
	});
}

start().catch((error) => {
	console.error('Failed to start storage service:', error);
	process.exit(1);
});
