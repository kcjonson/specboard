/**
 * @doc-platform/api
 * Backend API server using Hono.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import {
	generateSessionId,
	createSession,
	deleteSession,
	getSession,
	SESSION_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from '@doc-platform/auth';
import { query, type Epic as DbEpic, type Task as DbTask, type EpicStatus } from '@doc-platform/db';

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (err) => {
	console.error('Redis connection error:', err);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

// Mock users for local development
// In production, this will be replaced by Cognito
// Passwords can be overridden via environment variables
const MOCK_USERS = new Map([
	[
		'test@example.com',
		{
			id: 'user-1',
			email: 'test@example.com',
			password: process.env.MOCK_USER_PASSWORD || 'password123',
			displayName: 'Test User',
		},
	],
	[
		'admin@example.com',
		{
			id: 'user-2',
			email: 'admin@example.com',
			password: process.env.MOCK_ADMIN_PASSWORD || 'admin123',
			displayName: 'Admin User',
		},
	],
]);

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		// Still do a comparison to avoid early return timing leak
		crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
		return false;
	}
	return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Basic email format validation
 */
function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Valid status values
const VALID_STATUSES: EpicStatus[] = ['ready', 'in_progress', 'done'];

function isValidStatus(status: unknown): status is EpicStatus {
	return typeof status === 'string' && VALID_STATUSES.includes(status as EpicStatus);
}

// API types (camelCase for JSON responses)
interface ApiTask {
	id: string;
	epicId: string;
	title: string;
	status: EpicStatus;
	assignee?: string;
	dueDate?: string;
	rank: number;
}

interface ApiEpic {
	id: string;
	title: string;
	description?: string;
	status: EpicStatus;
	creator?: string;
	assignee?: string;
	rank: number;
	createdAt: string;
	updatedAt: string;
}

interface TaskStats {
	total: number;
	done: number;
}

// Transform database rows to API format
function dbEpicToApi(epic: DbEpic): ApiEpic {
	return {
		id: epic.id,
		title: epic.title,
		description: epic.description ?? undefined,
		status: epic.status,
		creator: epic.creator ?? undefined,
		assignee: epic.assignee ?? undefined,
		rank: epic.rank,
		createdAt: epic.createdAt.toISOString(),
		updatedAt: epic.updatedAt.toISOString(),
	};
}

function dbTaskToApi(task: DbTask): ApiTask {
	return {
		id: task.id,
		epicId: task.epicId,
		title: task.title,
		status: task.status,
		assignee: task.assignee ?? undefined,
		dueDate: task.dueDate?.toISOString().split('T')[0],
		rank: task.rank,
	};
}

// App
const app = new Hono();

// Middleware
app.use('*', cors());

// Health check (both paths for direct and ALB-routed access)
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// Auth endpoints

interface LoginRequest {
	email: string;
	password: string;
}

app.post('/api/auth/login', async (c) => {
	const body = await c.req.json<LoginRequest>();
	const { email, password } = body;

	// Input validation
	if (!email || !password) {
		return c.json({ error: 'Email and password are required' }, 400);
	}

	if (!isValidEmail(email)) {
		return c.json({ error: 'Invalid email format' }, 400);
	}

	if (password.length < 6) {
		return c.json({ error: 'Password must be at least 6 characters' }, 400);
	}

	// Mock authentication - replace with Cognito in production
	const user = MOCK_USERS.get(email.toLowerCase());
	if (!user || !safeCompare(password, user.password)) {
		return c.json({ error: 'Invalid email or password' }, 401);
	}

	// Create session with error handling
	const sessionId = generateSessionId();
	try {
		await createSession(redis, sessionId, {
			userId: user.id,
			email: user.email,
			displayName: user.displayName,
			// Mock tokens for development
			cognitoAccessToken: 'mock-access-token',
			cognitoRefreshToken: 'mock-refresh-token',
			cognitoExpiresAt: Date.now() + 3600000, // 1 hour
		});
	} catch (err) {
		console.error('Failed to create session:', err);
		return c.json({ error: 'Authentication service unavailable' }, 503);
	}

	// Set session cookie
	setCookie(c, SESSION_COOKIE_NAME, sessionId, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});

	return c.json({
		user: {
			id: user.id,
			email: user.email,
			displayName: user.displayName,
		},
	});
});

app.post('/api/auth/logout', async (c) => {
	const sessionId = getCookie(c, SESSION_COOKIE_NAME);

	if (sessionId) {
		try {
			await deleteSession(redis, sessionId);
		} catch (err) {
			console.error('Failed to delete session:', err);
			// Continue with logout even if Redis fails
		}
	}

	deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
	return c.json({ success: true });
});

app.get('/api/auth/me', async (c) => {
	const sessionId = getCookie(c, SESSION_COOKIE_NAME);

	if (!sessionId) {
		return c.json({ error: 'Not authenticated' }, 401);
	}

	try {
		const session = await getSession(redis, sessionId);
		if (!session) {
			return c.json({ error: 'Session expired' }, 401);
		}

		return c.json({
			user: {
				id: session.userId,
				email: session.email,
				displayName: session.displayName,
			},
		});
	} catch (err) {
		console.error('Failed to get session:', err);
		return c.json({ error: 'Authentication service unavailable' }, 503);
	}
});

// Epic endpoints
app.get('/api/epics', async (c) => {
	const result = await query<DbEpic>(`
		SELECT * FROM epics ORDER BY rank ASC
	`);

	// Get task stats for each epic
	const statsResult = await query<{ epicId: string; total: string; done: string }>(`
		SELECT
			"epicId",
			COUNT(*)::text as total,
			COUNT(*) FILTER (WHERE status = 'done')::text as done
		FROM tasks
		GROUP BY "epicId"
	`);

	const statsMap = new Map(
		statsResult.rows.map((row) => [
			row.epicId,
			{ total: parseInt(row.total, 10), done: parseInt(row.done, 10) },
		])
	);

	const epicList = result.rows.map((epic) => ({
		...dbEpicToApi(epic),
		taskStats: statsMap.get(epic.id) || { total: 0, done: 0 },
	}));

	return c.json(epicList);
});

app.get('/api/epics/:id', async (c) => {
	const id = c.req.param('id');

	const epicResult = await query<DbEpic>(`SELECT * FROM epics WHERE id = $1`, [id]);
	if (epicResult.rows.length === 0) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	const epic = epicResult.rows[0]!;

	const tasksResult = await query<DbTask>(
		`SELECT * FROM tasks WHERE "epicId" = $1 ORDER BY rank ASC`,
		[id]
	);

	const tasks = tasksResult.rows.map(dbTaskToApi);
	const taskStats: TaskStats = {
		total: tasks.length,
		done: tasks.filter((t) => t.status === 'done').length,
	};

	return c.json({
		...dbEpicToApi(epic),
		tasks,
		taskStats,
	});
});

app.post('/api/epics', async (c) => {
	const body = await c.req.json<Partial<ApiEpic>>();
	const status = body.status || 'ready';

	// Validate status
	if (body.status !== undefined && !isValidStatus(body.status)) {
		return c.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	// Calculate next rank for the status column
	const rankResult = await query<{ max_rank: number | null }>(
		`SELECT MAX(rank) as max_rank FROM epics WHERE status = $1`,
		[status]
	);
	const maxRank = rankResult.rows[0]?.max_rank ?? 0;

	const result = await query<DbEpic>(
		`INSERT INTO epics (title, description, status, creator, assignee, rank)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING *`,
		[body.title || 'Untitled Epic', body.description || null, status, body.creator || null, body.assignee || null, maxRank + 1]
	);

	const epic = result.rows[0]!;
	return c.json(dbEpicToApi(epic), 201);
});

app.put('/api/epics/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req.json<Partial<ApiEpic>>();

	// Validate status if provided
	if (body.status !== undefined && !isValidStatus(body.status)) {
		return c.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	// Build dynamic update query
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (body.title !== undefined) {
		updates.push(`title = $${paramIndex++}`);
		values.push(body.title);
	}
	if (body.description !== undefined) {
		updates.push(`description = $${paramIndex++}`);
		values.push(body.description || null);
	}
	if (body.status !== undefined) {
		updates.push(`status = $${paramIndex++}`);
		values.push(body.status);
	}
	if (body.creator !== undefined) {
		updates.push(`creator = $${paramIndex++}`);
		values.push(body.creator || null);
	}
	if (body.assignee !== undefined) {
		updates.push(`assignee = $${paramIndex++}`);
		values.push(body.assignee || null);
	}
	if (body.rank !== undefined) {
		updates.push(`rank = $${paramIndex++}`);
		values.push(body.rank);
	}

	if (updates.length === 0) {
		// No updates, just return the existing epic
		const result = await query<DbEpic>(`SELECT * FROM epics WHERE id = $1`, [id]);
		if (result.rows.length === 0) {
			return c.json({ error: 'Epic not found' }, 404);
		}
		return c.json(dbEpicToApi(result.rows[0]!));
	}

	values.push(id);
	const result = await query<DbEpic>(
		`UPDATE epics SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
		values
	);

	if (result.rows.length === 0) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	return c.json(dbEpicToApi(result.rows[0]!));
});

app.delete('/api/epics/:id', async (c) => {
	const id = c.req.param('id');

	// Tasks are deleted automatically via ON DELETE CASCADE
	const result = await query(`DELETE FROM epics WHERE id = $1 RETURNING id`, [id]);

	if (result.rowCount === 0) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	return c.json({ success: true });
});

// Task endpoints
app.get('/api/epics/:epicId/tasks', async (c) => {
	const epicId = c.req.param('epicId');

	// Check if epic exists
	const epicResult = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
	if (epicResult.rows.length === 0) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	const result = await query<DbTask>(
		`SELECT * FROM tasks WHERE "epicId" = $1 ORDER BY rank ASC`,
		[epicId]
	);

	return c.json(result.rows.map(dbTaskToApi));
});

app.post('/api/epics/:epicId/tasks', async (c) => {
	const epicId = c.req.param('epicId');

	// Check if epic exists
	const epicResult = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
	if (epicResult.rows.length === 0) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	const body = await c.req.json<Partial<ApiTask>>();

	// Validate status if provided
	if (body.status !== undefined && !isValidStatus(body.status)) {
		return c.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	// Calculate next rank
	const rankResult = await query<{ max_rank: number | null }>(
		`SELECT MAX(rank) as max_rank FROM tasks WHERE "epicId" = $1`,
		[epicId]
	);
	const maxRank = rankResult.rows[0]?.max_rank ?? 0;

	const result = await query<DbTask>(
		`INSERT INTO tasks ("epicId", title, status, assignee, "dueDate", rank)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING *`,
		[
			epicId,
			body.title || 'Untitled Task',
			body.status || 'ready',
			body.assignee || null,
			body.dueDate || null,
			maxRank + 1,
		]
	);

	const task = result.rows[0]!;
	return c.json(dbTaskToApi(task), 201);
});

app.put('/api/tasks/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req.json<Partial<ApiTask>>();

	// Validate status if provided
	if (body.status !== undefined && !isValidStatus(body.status)) {
		return c.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	// Build dynamic update query
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (body.title !== undefined) {
		updates.push(`title = $${paramIndex++}`);
		values.push(body.title);
	}
	if (body.status !== undefined) {
		updates.push(`status = $${paramIndex++}`);
		values.push(body.status);
	}
	if (body.assignee !== undefined) {
		updates.push(`assignee = $${paramIndex++}`);
		values.push(body.assignee || null);
	}
	if (body.dueDate !== undefined) {
		updates.push(`"dueDate" = $${paramIndex++}`);
		values.push(body.dueDate || null);
	}
	if (body.rank !== undefined) {
		updates.push(`rank = $${paramIndex++}`);
		values.push(body.rank);
	}

	if (updates.length === 0) {
		// No updates, just return the existing task
		const result = await query<DbTask>(`SELECT * FROM tasks WHERE id = $1`, [id]);
		if (result.rows.length === 0) {
			return c.json({ error: 'Task not found' }, 404);
		}
		return c.json(dbTaskToApi(result.rows[0]!));
	}

	values.push(id);
	const result = await query<DbTask>(
		`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
		values
	);

	if (result.rows.length === 0) {
		return c.json({ error: 'Task not found' }, 404);
	}

	return c.json(dbTaskToApi(result.rows[0]!));
});

app.delete('/api/tasks/:id', async (c) => {
	const id = c.req.param('id');

	const result = await query(`DELETE FROM tasks WHERE id = $1 RETURNING id`, [id]);

	if (result.rowCount === 0) {
		return c.json({ error: 'Task not found' }, 404);
	}

	return c.json({ success: true });
});

// Start server
const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`API server running on http://localhost:${PORT}`);
});
