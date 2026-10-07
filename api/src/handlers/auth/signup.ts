/**
 * Signup handler
 *
 * Email-only: an account is created from just an email address, and the first login
 * happens via magic link, which also verifies the email. Username, names, and an
 * optional password are collected by the post-first-login onboarding flow.
 *
 * Signup is gated. Either an early-access key from INVITE_KEYS, or the token of an open
 * project invitation, which only ever opens an account for the invited address. An
 * invitation signup's magic link carries the invite page as its next path, so the new
 * user comes back to the invitation once they are signed in.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { checkRateLimitKey, hashToken, RATE_LIMIT_CONFIGS } from '@specboard/auth';
import { getInvitationByTokenHash, query, type User, type SignupMetadata } from '@specboard/db';

import { isValidEmail } from '../../validation.ts';
import { logAuthEvent, isValidInviteKey } from './utils.ts';
import { issueMagicLink } from './magic-link.ts';

interface SignupRequest {
	email?: string;
	/** An early-access key from INVITE_KEYS. */
	invite_key?: string;
	/** A project invitation's token, in place of invite_key. Its address is the account's. */
	invite_token?: string;
	// Optional acquisition tracking
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_term?: string;
	utm_content?: string;
	referral_source?: string;
}

const INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Who may sign up, and with what: the address, where the magic link lands, what to record. */
interface SignupGrant {
	email: string;
	nextPath: string | null;
	metadata: SignupMetadata;
}

/**
 * Check the signup gate. A project invitation token must name an open invitation, and
 * the account is for the invited address: an email in the body has to match it, and
 * the page leaves it out, since it only shows the address masked.
 */
async function signupGrant(body: SignupRequest): Promise<SignupGrant | { error: string; status: 400 | 403 }> {
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

	if (body.invite_token !== undefined) {
		const token = body.invite_token;
		const invitation = typeof token === 'string' && INVITE_TOKEN_PATTERN.test(token)
			? await getInvitationByTokenHash(hashToken(token))
			: null;
		if (!invitation || invitation.state !== 'open') {
			return { error: 'This invitation is no longer valid', status: 403 };
		}
		if (email && email !== invitation.email) {
			return { error: 'This invitation was sent to a different email address', status: 403 };
		}
		return {
			email: invitation.email,
			nextPath: `/invite?token=${token}`,
			metadata: { project_invitation_id: invitation.id },
		};
	}

	if (!email || typeof body.invite_key !== 'string' || !body.invite_key) {
		return { error: 'Email and invite key are required', status: 400 };
	}
	if (!isValidInviteKey(body.invite_key)) {
		return { error: 'Invalid invite key', status: 403 };
	}
	if (!isValidEmail(email)) {
		return { error: 'Invalid email format', status: 400 };
	}
	return { email, nextPath: null, metadata: { invite_key: body.invite_key.trim() } };
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

	if (!body || typeof body !== 'object') {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { utm_source, utm_medium, utm_campaign, utm_term, utm_content, referral_source } = body;

	let grant: SignupGrant;
	try {
		const checked = await signupGrant(body);
		if ('error' in checked) {
			return context.json({ error: checked.error }, checked.status);
		}
		grant = checked;
	} catch (error) {
		console.error('Signup invitation lookup failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Failed to create account' }, 500);
	}
	const { email } = grant;

	// Identical body whether the email is new or already registered
	const successResponse = {
		message: 'Check your email for a sign-in code.',
		email,
	};

	try {
		// Same per-email bucket as the login-side request endpoint, so signup
		// can't be used to multiply sign-in emails past the cap
		const emailKey = `ratelimit:magic-link-email:${hashToken(email).slice(0, 32)}`;
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
				await issueMagicLink(existingUser, grant.nextPath);
			}
			return context.json(successResponse, 201);
		}

		// Build signup metadata (only accept strings, truncate to prevent storage abuse)
		const MAX_UTM_LENGTH = 500;
		const sanitize = (val: unknown): string | undefined =>
			typeof val === 'string' && val ? val.slice(0, MAX_UTM_LENGTH) : undefined;

		const signupMetadata: SignupMetadata = { ...grant.metadata };
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
			[email, JSON.stringify(signupMetadata)]
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'Failed to create account' }, 500);
		}

		await issueMagicLink(user, grant.nextPath);
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
