/**
 * Auth handlers
 */

import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import {
	generateSessionId,
	createSession,
	deleteSession,
	getSession,
	SESSION_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from '@doc-platform/auth';
import { isValidEmail } from '../validation.js';

// Mock users for local development
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

function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
		return false;
	}
	return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface LoginRequest {
	email: string;
	password: string;
}

export async function handleLogin(context: Context, redis: Redis): Promise<Response> {
	const body = await context.req.json<LoginRequest>();
	const { email, password } = body;

	if (!email || !password) {
		return context.json({ error: 'Email and password are required' }, 400);
	}

	if (!isValidEmail(email)) {
		return context.json({ error: 'Invalid email format' }, 400);
	}

	if (password.length < 6) {
		return context.json({ error: 'Password must be at least 6 characters' }, 400);
	}

	const user = MOCK_USERS.get(email.toLowerCase());
	if (!user || !safeCompare(password, user.password)) {
		return context.json({ error: 'Invalid email or password' }, 401);
	}

	const sessionId = generateSessionId();
	try {
		await createSession(redis, sessionId, {
			userId: user.id,
			email: user.email,
			displayName: user.displayName,
			cognitoAccessToken: 'mock-access-token',
			cognitoRefreshToken: 'mock-refresh-token',
			cognitoExpiresAt: Date.now() + 3600000,
		});
	} catch (error) {
		console.error('Failed to create session:', error);
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}

	setCookie(context, SESSION_COOKIE_NAME, sessionId, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});

	return context.json({
		user: {
			id: user.id,
			email: user.email,
			displayName: user.displayName,
		},
	});
}

export async function handleLogout(context: Context, redis: Redis): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (sessionId) {
		try {
			await deleteSession(redis, sessionId);
		} catch (error) {
			console.error('Failed to delete session:', error);
		}
	}

	deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
	return context.json({ success: true });
}

export async function handleGetMe(context: Context, redis: Redis): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (!sessionId) {
		return context.json({ error: 'Not authenticated' }, 401);
	}

	try {
		const session = await getSession(redis, sessionId);
		if (!session) {
			return context.json({ error: 'Session expired' }, 401);
		}

		return context.json({
			user: {
				id: session.userId,
				email: session.email,
				displayName: session.displayName,
			},
		});
	} catch (error) {
		console.error('Failed to get session:', error);
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}
