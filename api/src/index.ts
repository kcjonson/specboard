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

// Types
interface Task {
	id: string;
	epicId: string;
	title: string;
	status: 'ready' | 'in_progress' | 'done';
	assignee?: string;
	dueDate?: string;
	rank: number;
}

interface Epic {
	id: string;
	title: string;
	description?: string;
	status: 'ready' | 'in_progress' | 'done';
	assignee?: string;
	rank: number;
	createdAt: string;
	updatedAt: string;
}

// In-memory storage
const epics: Map<string, Epic> = new Map();
const tasks: Map<string, Task> = new Map();

// Seed sample data
function seedData(): void {
	const sampleEpics: Epic[] = [
		{
			id: '1',
			title: 'User Authentication',
			description: 'Implement login, signup, and password reset flows.',
			status: 'in_progress',
			assignee: 'alice',
			rank: 1,
			createdAt: '2025-12-20T10:00:00Z',
			updatedAt: '2025-12-23T14:30:00Z',
		},
		{
			id: '2',
			title: 'Dashboard Analytics',
			description: 'Build analytics dashboard with charts and metrics.',
			status: 'ready',
			rank: 2,
			createdAt: '2025-12-21T09:00:00Z',
			updatedAt: '2025-12-21T09:00:00Z',
		},
		{
			id: '3',
			title: 'API Documentation',
			description: 'Write comprehensive API docs with examples.',
			status: 'done',
			assignee: 'bob',
			rank: 1,
			createdAt: '2025-12-18T11:00:00Z',
			updatedAt: '2025-12-22T16:00:00Z',
		},
		{
			id: '4',
			title: 'Performance Optimization',
			description: 'Improve load times and reduce bundle size.',
			status: 'ready',
			rank: 3,
			createdAt: '2025-12-22T08:00:00Z',
			updatedAt: '2025-12-22T08:00:00Z',
		},
	];

	const sampleTasks: Task[] = [
		{ id: '101', epicId: '1', title: 'Design login UI', status: 'done', rank: 1 },
		{ id: '102', epicId: '1', title: 'Implement login API', status: 'done', rank: 2 },
		{ id: '103', epicId: '1', title: 'Implement login form', status: 'in_progress', assignee: 'alice', rank: 3 },
		{ id: '104', epicId: '1', title: 'Add form validation', status: 'ready', rank: 4 },
		{ id: '105', epicId: '1', title: 'Implement password reset', status: 'ready', rank: 5 },
		{ id: '201', epicId: '2', title: 'Design dashboard layout', status: 'ready', rank: 1 },
		{ id: '202', epicId: '2', title: 'Implement chart components', status: 'ready', rank: 2 },
		{ id: '301', epicId: '3', title: 'Write endpoint docs', status: 'done', rank: 1 },
		{ id: '302', epicId: '3', title: 'Add code examples', status: 'done', rank: 2 },
	];

	sampleEpics.forEach((epic) => epics.set(epic.id, epic));
	sampleTasks.forEach((task) => tasks.set(task.id, task));
}

seedData();

// Utility
function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getTasksForEpic(epicId: string): Task[] {
	return Array.from(tasks.values())
		.filter((t) => t.epicId === epicId)
		.sort((a, b) => a.rank - b.rank);
}

function getTaskStats(epicId: string): { total: number; done: number } {
	const epicTasks = getTasksForEpic(epicId);
	return {
		total: epicTasks.length,
		done: epicTasks.filter((t) => t.status === 'done').length,
	};
}

// App
const app = new Hono();

// Middleware
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Auth endpoints

interface LoginRequest {
	email: string;
	password: string;
}

app.post('/auth/login', async (c) => {
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

app.post('/auth/logout', async (c) => {
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

app.get('/auth/me', async (c) => {
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
app.get('/api/epics', (c) => {
	const epicList = Array.from(epics.values())
		.sort((a, b) => a.rank - b.rank)
		.map((epic) => ({
			...epic,
			taskStats: getTaskStats(epic.id),
		}));
	return c.json(epicList);
});

app.get('/api/epics/:id', (c) => {
	const epic = epics.get(c.req.param('id'));
	if (!epic) {
		return c.json({ error: 'Epic not found' }, 404);
	}
	return c.json({
		...epic,
		tasks: getTasksForEpic(epic.id),
		taskStats: getTaskStats(epic.id),
	});
});

app.post('/api/epics', async (c) => {
	const body = await c.req.json<Partial<Epic>>();
	const now = new Date().toISOString();

	// Calculate next rank for the status column
	const sameStatusEpics = Array.from(epics.values()).filter(
		(e) => e.status === (body.status || 'ready')
	);
	const maxRank = Math.max(0, ...sameStatusEpics.map((e) => e.rank));

	const epic: Epic = {
		id: generateId(),
		title: body.title || 'Untitled Epic',
		description: body.description,
		status: body.status || 'ready',
		assignee: body.assignee,
		rank: maxRank + 1,
		createdAt: now,
		updatedAt: now,
	};

	epics.set(epic.id, epic);
	return c.json(epic, 201);
});

app.put('/api/epics/:id', async (c) => {
	const id = c.req.param('id');
	const existing = epics.get(id);
	if (!existing) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	const body = await c.req.json<Partial<Epic>>();
	const updated: Epic = {
		...existing,
		...body,
		id, // Prevent ID change
		updatedAt: new Date().toISOString(),
	};

	epics.set(id, updated);
	return c.json(updated);
});

app.delete('/api/epics/:id', (c) => {
	const id = c.req.param('id');
	if (!epics.has(id)) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	// Delete associated tasks
	Array.from(tasks.values())
		.filter((t) => t.epicId === id)
		.forEach((t) => tasks.delete(t.id));

	epics.delete(id);
	return c.json({ success: true });
});

// Task endpoints
app.get('/api/epics/:epicId/tasks', (c) => {
	const epicId = c.req.param('epicId');
	if (!epics.has(epicId)) {
		return c.json({ error: 'Epic not found' }, 404);
	}
	return c.json(getTasksForEpic(epicId));
});

app.post('/api/epics/:epicId/tasks', async (c) => {
	const epicId = c.req.param('epicId');
	if (!epics.has(epicId)) {
		return c.json({ error: 'Epic not found' }, 404);
	}

	const body = await c.req.json<Partial<Task>>();

	// Calculate next rank
	const epicTasks = getTasksForEpic(epicId);
	const maxRank = Math.max(0, ...epicTasks.map((t) => t.rank));

	const task: Task = {
		id: generateId(),
		epicId,
		title: body.title || 'Untitled Task',
		status: body.status || 'ready',
		assignee: body.assignee,
		dueDate: body.dueDate,
		rank: maxRank + 1,
	};

	tasks.set(task.id, task);
	return c.json(task, 201);
});

app.put('/api/tasks/:id', async (c) => {
	const id = c.req.param('id');
	const existing = tasks.get(id);
	if (!existing) {
		return c.json({ error: 'Task not found' }, 404);
	}

	const body = await c.req.json<Partial<Task>>();
	const updated: Task = {
		...existing,
		...body,
		id, // Prevent ID change
		epicId: existing.epicId, // Prevent epic change
	};

	tasks.set(id, updated);
	return c.json(updated);
});

app.delete('/api/tasks/:id', (c) => {
	const id = c.req.param('id');
	if (!tasks.has(id)) {
		return c.json({ error: 'Task not found' }, 404);
	}
	tasks.delete(id);
	return c.json({ success: true });
});

// Start server
const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`API server running on http://localhost:${PORT}`);
});
