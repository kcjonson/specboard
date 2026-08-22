/**
 * Magic link login handlers
 *
 * A magic link row carries two credentials for the same sign-in: a 256-bit
 * URL token and a short typed code. The code's low entropy (~39 bits) is only
 * acceptable because attempts are counted per row and the row expires in 15
 * minutes; both credentials are single-use via delete-on-consume.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import {
	generateToken,
	hashToken,
	verifyToken,
	generateLoginCode,
	normalizeLoginCode,
	isTokenExpired,
	checkRateLimitKey,
	MAGIC_LINK_EXPIRY_MS,
	RATE_LIMIT_CONFIGS,
} from '@specboard/auth';
import { query, type User } from '@specboard/db';
import { sendEmail, getMagicLinkEmailContent } from '@specboard/email';

import { isValidEmail } from '../../validation.ts';
import { logAuthEvent, establishSession, isCrossOriginRequest, APP_URL } from './utils.ts';

const MAX_CODE_ATTEMPTS = 5;

// Compared against when no token row exists, to keep the code path's timing
// shape independent of row existence
const DUMMY_CODE_HASH = hashToken('DUMMYCODE');

interface MagicLinkTokenRow {
	id: string;
	user_id: string;
	token_hash: string;
	code_hash: string;
	code_attempts: number;
	next_path: string | null;
	expires_at: Date;
}

/**
 * Validate a client-supplied post-login path. Same-origin relative paths only.
 */
function sanitizeNextPath(next: unknown): string | null {
	if (typeof next !== 'string') return null;
	if (!next.startsWith('/') || next.startsWith('//') || next.length > 2048) return null;
	// Backslashes normalize to '//' in the browser (off-site redirect); control
	// chars (esp. NUL) would also make the row INSERT throw and get masked as a
	// fake "code sent". Drop the path rather than fail the whole request.
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\\]/.test(next)) return null;
	return next;
}

/**
 * Issue a fresh magic link for a user: replaces any pending one (atomically,
 * via the one-row-per-user unique index), stores hashes, and sends the email
 * (fire-and-forget; the user can re-request). Also used by email-only signup.
 */
export async function issueMagicLink(
	user: Pick<User, 'id' | 'email'>,
	nextPath: string | null
): Promise<void> {
	const token = generateToken();
	const code = generateLoginCode();
	const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

	// Upsert rather than DELETE-then-INSERT: two concurrent requests would
	// otherwise interleave into two live rows and let the newest code get
	// checked against a stale row. ON CONFLICT also resets code_attempts.
	await query(
		`INSERT INTO magic_link_tokens (user_id, token_hash, code_hash, next_path, expires_at)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id) DO UPDATE SET
			token_hash = EXCLUDED.token_hash,
			code_hash = EXCLUDED.code_hash,
			code_attempts = 0,
			next_path = EXCLUDED.next_path,
			expires_at = EXCLUDED.expires_at,
			created_at = NOW()`,
		[user.id, hashToken(token), hashToken(code), nextPath, expiresAt]
	);

	const loginUrl = `${APP_URL}/magic-link?token=${token}`;
	const formattedCode = `${code.slice(0, 4)}-${code.slice(4)}`;
	const emailContent = getMagicLinkEmailContent(loginUrl, formattedCode);

	sendEmail({
		to: user.email,
		subject: emailContent.subject,
		textBody: emailContent.textBody,
		htmlBody: emailContent.htmlBody,
	}).catch((error) => {
		console.error('Magic link email failed:', error instanceof Error ? error.message : 'Unknown error');
	});
}

interface MagicLinkRequestBody {
	email: string;
	next?: string;
}

/**
 * Handle a sign-in code request
 */
export async function handleMagicLinkRequest(
	context: Context,
	redis: Redis
): Promise<Response> {
	let body: MagicLinkRequestBody;
	try {
		body = await context.req.json<MagicLinkRequestBody>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	// json() resolves null/scalars without throwing; guard before member access
	if (!body || typeof body !== 'object') {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const email = typeof body.email === 'string' ? body.email.trim() : '';
	if (!email || !isValidEmail(email)) {
		return context.json({ error: 'A valid email address is required' }, 400);
	}

	// Same response whether or not the email has an account
	const successResponse = { message: 'If that email has an account, we sent a sign-in code.' };

	try {
		// Per-email cap, checked before the account lookup so the 429 carries
		// no account-existence signal. Key material is hashed: the privacy
		// policy doesn't disclose storing raw emails in rate-limit state.
		const emailKey = `ratelimit:magic-link-email:${hashToken(email.toLowerCase()).slice(0, 32)}`;
		const allowed = await checkRateLimitKey(redis, emailKey, RATE_LIMIT_CONFIGS.magicLinkEmail);
		if (!allowed) {
			return context.json({ error: RATE_LIMIT_CONFIGS.magicLinkEmail.message }, 429);
		}

		const userResult = await query<User>(
			'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
			[email]
		);
		const user = userResult.rows[0];

		// Unverified users may sign in this way (consuming the link proves the
		// email); deactivated users may not
		if (!user || !user.is_active) {
			return context.json(successResponse);
		}

		await issueMagicLink(user, sanitizeNextPath(body.next));
		logAuthEvent('magic_link_requested', { userId: user.id });

		return context.json(successResponse);
	} catch (error) {
		console.error('Magic link request failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json(successResponse);
	}
}

interface MagicLinkVerifyBody {
	token?: string;
	email?: string;
	code?: string;
}

const GENERIC_FAILURE = 'That code or link is invalid or has expired.';

/**
 * Handle magic link consumption: either {token} from the emailed link or
 * {email, code} typed into the login page. All failure modes return the same
 * message so responses don't distinguish invalid, expired, or consumed.
 */
export async function handleMagicLinkVerify(
	context: Context,
	redis: Redis
): Promise<Response> {
	// This endpoint creates a session and is CSRF-exempt, so guard against
	// cross-site login-CSRF via the Origin header.
	if (isCrossOriginRequest(context)) {
		return context.json({ error: 'Cross-origin request rejected' }, 403);
	}

	let body: MagicLinkVerifyBody;
	try {
		body = await context.req.json<MagicLinkVerifyBody>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	if (!body || typeof body !== 'object') {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const hasToken = typeof body.token === 'string' && body.token.length > 0;
	const hasCode = typeof body.email === 'string' && typeof body.code === 'string';
	if (!hasToken && !hasCode) {
		return context.json({ error: 'A token, or an email and code, is required' }, 400);
	}

	const fail = (reason: string): Response => {
		logAuthEvent('magic_link_failure', { reason });
		return context.json({ error: GENERIC_FAILURE }, 401);
	};

	try {
		let row: MagicLinkTokenRow | undefined;

		if (hasToken) {
			const token = body.token as string;
			if (!/^[a-f0-9]{64}$/i.test(token)) {
				return fail('malformed_token');
			}

			const result = await query<MagicLinkTokenRow>(
				'SELECT * FROM magic_link_tokens WHERE token_hash = $1',
				[hashToken(token)]
			);
			row = result.rows[0];
			if (!row) {
				return fail('unknown_token');
			}
		} else {
			const normalized = normalizeLoginCode(body.code as string);
			if (!normalized) {
				return fail('malformed_code');
			}

			const result = await query<MagicLinkTokenRow>(
				`SELECT t.* FROM magic_link_tokens t
				 JOIN users u ON u.id = t.user_id
				 WHERE LOWER(u.email) = LOWER($1)`,
				[(body.email as string).trim()]
			);
			row = result.rows[0];
			if (!row) {
				verifyToken(normalized, DUMMY_CODE_HASH);
				return fail('no_pending_code');
			}

			// Count the attempt before comparing so parallel guesses can't
			// slip past the cap; delete the row once it's exhausted
			const attemptResult = await query<{ code_attempts: number }>(
				'UPDATE magic_link_tokens SET code_attempts = code_attempts + 1 WHERE id = $1 RETURNING code_attempts',
				[row.id]
			);
			const attempts = attemptResult.rows[0]?.code_attempts ?? MAX_CODE_ATTEMPTS + 1;
			if (attempts > MAX_CODE_ATTEMPTS) {
				await query('DELETE FROM magic_link_tokens WHERE id = $1', [row.id]);
				return fail('attempts_exhausted');
			}

			if (!verifyToken(normalized, row.code_hash)) {
				return fail('wrong_code');
			}
		}

		if (isTokenExpired(row.expires_at)) {
			await query('DELETE FROM magic_link_tokens WHERE id = $1', [row.id]);
			return fail('expired');
		}

		// Atomic consume; a concurrent verify of the same row loses here
		const consumed = await query(
			'DELETE FROM magic_link_tokens WHERE id = $1 RETURNING id',
			[row.id]
		);
		if (consumed.rows.length === 0) {
			return fail('already_consumed');
		}

		const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [row.user_id]);
		const user = userResult.rows[0];
		if (!user || !user.is_active) {
			return fail('account_inactive');
		}

		// Possession of the email is proven, so this doubles as verification
		const verifiedUpdate = await query(
			'UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1 AND email_verified = false',
			[user.id]
		);
		if ((verifiedUpdate.rowCount ?? 0) > 0) {
			logAuthEvent('email_verified', { userId: user.id });
		}

		await establishSession(context, redis, user.id, 'magic_link');
		logAuthEvent('magic_link_login', { userId: user.id, method: hasToken ? 'link' : 'code' });

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				first_name: user.first_name,
				last_name: user.last_name,
				avatar_url: user.avatar_url,
			},
			next: row.next_path,
		});
	} catch (error) {
		console.error('Magic link verify failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}
