/**
 * Signup handler
 *
 * Email-only: an account is created from just an email address (plus the
 * invite key gate), and the first login happens via magic link, which also
 * verifies the email. Username, names, and an optional password are collected
 * by the post-first-login onboarding flow.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { checkRateLimitKey, hashToken, RATE_LIMIT_CONFIGS } from '@specboard/auth';
import { query, type User, type SignupMetadata } from '@specboard/db';

import { isValidEmail } from '../../validation.ts';
import { logAuthEvent, isValidInviteKey } from './utils.ts';
import { issueMagicLink } from './magic-link.ts';

interface SignupRequest {
	email: string;
	invite_key: string;
	// Optional acquisition tracking
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_term?: string;
	utm_content?: string;
	referral_source?: string;
}

/**
 * Handle user signup
 */
export async function handleSignup(context: Context, redis: Redis): Promise<Response> {
	let body: SignupRequest;
	try {
		body = await context.req.json<SignupRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const {
		email, invite_key,
		utm_source, utm_medium, utm_campaign, utm_term, utm_content, referral_source,
	} = body;

	if (!email || !invite_key) {
		return context.json({ error: 'Email and invite key are required' }, 400);
	}

	if (!isValidInviteKey(invite_key)) {
		return context.json({ error: 'Invalid invite key' }, 403);
	}

	if (!isValidEmail(email)) {
		return context.json({ error: 'Invalid email format' }, 400);
	}

	// Identical body whether the email is new or already registered
	const successResponse = {
		message: 'Check your email for a sign-in code.',
		email: email.toLowerCase(),
	};

	try {
		// Same per-email bucket as the login-side request endpoint, so signup
		// can't be used to multiply sign-in emails past the cap
		const emailKey = `ratelimit:magic-link-email:${hashToken(email.toLowerCase()).slice(0, 32)}`;
		const allowed = await checkRateLimitKey(redis, emailKey, RATE_LIMIT_CONFIGS.magicLinkEmail);
		if (!allowed) {
			return context.json({ error: RATE_LIMIT_CONFIGS.magicLinkEmail.message }, 429);
		}

		// Existing email: send a login link instead of erroring, with the same
		// response body, so signup can't be used to enumerate accounts
		const existing = await query<User>(
			'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
			[email]
		);
		const existingUser = existing.rows[0];
		if (existingUser) {
			if (existingUser.is_active) {
				await issueMagicLink(existingUser, null);
			}
			return context.json(successResponse, 201);
		}

		// Build signup metadata (only accept strings, truncate to prevent storage abuse)
		const MAX_UTM_LENGTH = 500;
		const sanitize = (val: unknown): string | undefined =>
			typeof val === 'string' && val ? val.slice(0, MAX_UTM_LENGTH) : undefined;

		const signupMetadata: SignupMetadata = { invite_key: invite_key.trim() };
		if (utm_source) signupMetadata.utm_source = sanitize(utm_source);
		if (utm_medium) signupMetadata.utm_medium = sanitize(utm_medium);
		if (utm_campaign) signupMetadata.utm_campaign = sanitize(utm_campaign);
		if (utm_term) signupMetadata.utm_term = sanitize(utm_term);
		if (utm_content) signupMetadata.utm_content = sanitize(utm_content);
		if (referral_source) signupMetadata.referral_source = sanitize(referral_source);

		const userResult = await query<User>(
			`INSERT INTO users (email, email_verified, signup_metadata)
			 VALUES ($1, false, $2)
			 RETURNING *`,
			[email.toLowerCase(), JSON.stringify(signupMetadata)]
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'Failed to create account' }, 500);
		}

		await issueMagicLink(user, null);
		logAuthEvent('signup_success', { userId: user.id });

		return context.json(successResponse, 201);
	} catch (error) {
		// Unique-violation race between the existence check and insert: the
		// email got registered concurrently, which lands in the same
		// existing-email semantics
		if (error instanceof Error && 'code' in error && error.code === '23505') {
			return context.json(successResponse, 201);
		}
		console.error('Signup failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Failed to create account' }, 500);
	}
}
