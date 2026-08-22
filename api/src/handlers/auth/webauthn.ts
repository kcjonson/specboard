/**
 * Passkey (WebAuthn) handlers — thin orchestration over the hand-rolled
 * verifier in @specboard/auth. The verifier checks the ceremony; these
 * handlers own the obligations it can't: challenge storage/consumption,
 * credential ownership + userHandle resolution, counter write-back, and
 * duplicate-credential rejection.
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';
import {
	getSession,
	verifyRegistration,
	verifyAuthentication,
	fromBase64url,
	toBase64url,
	SESSION_COOKIE_NAME,
} from '@specboard/auth';
import { query, type User } from '@specboard/db';

import { logAuthEvent, establishSession, isCrossOriginRequest, APP_URL } from './utils.ts';

// RP config. rpId is the effective domain; origin is the exact page origin.
// Both env-overridable for deployments where the API host differs from the
// user-facing origin.
const RP_ID = process.env.WEBAUTHN_RP_ID || new URL(APP_URL).hostname;
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || new URL(APP_URL).origin;
const RP_NAME = 'Specboard';

const CHALLENGE_TTL_SECONDS = 300;
const REQUIRE_UV = true;
const MAX_PASSKEYS_PER_USER = 20;

type ChallengeType = 'registration' | 'authentication';
interface StoredChallenge {
	type: ChallengeType;
	challenge: string; // base64url
	userId?: string;
}

function challengeKey(id: string): string {
	return `webauthn:challenge:${id}`;
}

async function storeChallenge(
	redis: Redis,
	data: { type: ChallengeType; userId?: string }
): Promise<{ challengeId: string; challenge: string }> {
	const challenge = toBase64url(randomBytes(32));
	const challengeId = randomBytes(16).toString('hex');
	const record: StoredChallenge = { type: data.type, challenge, userId: data.userId };
	await redis.setex(challengeKey(challengeId), CHALLENGE_TTL_SECONDS, JSON.stringify(record));
	return { challengeId, challenge };
}

/** Consume a challenge exactly once (GETDEL); returns null if missing/expired. */
async function consumeChallenge(redis: Redis, challengeId: string): Promise<StoredChallenge | null> {
	if (typeof challengeId !== 'string' || !/^[a-f0-9]{32}$/.test(challengeId)) return null;
	const raw = await redis.getdel(challengeKey(challengeId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StoredChallenge;
	} catch {
		return null;
	}
}

async function getSessionUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;
	const session = await getSession(redis, sessionId);
	return session?.userId ?? null;
}

function userJson(user: User): Record<string, unknown> {
	return {
		id: user.id,
		username: user.username,
		email: user.email,
		first_name: user.first_name,
		last_name: user.last_name,
		avatar_url: user.avatar_url,
	};
}

interface CredentialRow {
	id: string;
	user_id: string;
	credential_id: string;
	public_key: Buffer;
	counter: string; // pg returns BIGINT as string
	transports: string[] | null;
}

// ---- Authentication (login) ----

export async function handleWebauthnLoginOptions(context: Context, redis: Redis): Promise<Response> {
	// CSRF-exempt like verify; guard against cross-site pages minting challenges.
	if (isCrossOriginRequest(context)) {
		return context.json({ error: 'Cross-origin request rejected' }, 403);
	}
	const { challengeId, challenge } = await storeChallenge(redis, { type: 'authentication' });
	return context.json({
		challengeId,
		options: {
			challenge,
			rpId: RP_ID,
			timeout: 60000,
			userVerification: 'required',
			// Empty allowCredentials → discoverable (usernameless) login.
			allowCredentials: [],
		},
	});
}

interface LoginVerifyBody {
	challengeId: string;
	id: string; // credential id, base64url
	clientDataJSON: string;
	authenticatorData: string;
	signature: string;
	userHandle?: string | null;
}

const GENERIC_LOGIN_FAILURE = 'Passkey sign-in failed.';

export async function handleWebauthnLoginVerify(context: Context, redis: Redis): Promise<Response> {
	// Session-creating + CSRF-exempt: guard against cross-site login-CSRF.
	if (isCrossOriginRequest(context)) {
		return context.json({ error: 'Cross-origin request rejected' }, 403);
	}

	let body: LoginVerifyBody;
	try {
		body = await context.req.json<LoginVerifyBody>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	if (!body || typeof body !== 'object' || typeof body.id !== 'string') {
		return context.json({ error: 'Invalid request' }, 400);
	}

	const fail = (reason: string): Response => {
		logAuthEvent('passkey_login', { result: 'failure', reason });
		return context.json({ error: GENERIC_LOGIN_FAILURE }, 401);
	};

	try {
		const stored = await consumeChallenge(redis, body.challengeId);
		if (!stored || stored.type !== 'authentication') return fail('bad_challenge');

		// Ownership: resolve the credential the assertion claims to a stored row.
		const credResult = await query<CredentialRow>(
			'SELECT * FROM webauthn_credentials WHERE credential_id = $1',
			[body.id]
		);
		const cred = credResult.rows[0];
		if (!cred) return fail('unknown_credential');

		// userHandle, when present, must resolve to the credential's owner —
		// otherwise a valid signature from credential A could be claimed as user B.
		if (body.userHandle) {
			let handle: string;
			try {
				handle = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(body.userHandle));
			} catch {
				return fail('bad_user_handle');
			}
			if (handle !== cred.user_id) return fail('user_handle_mismatch');
		}

		let verified;
		try {
			verified = verifyAuthentication({
				response: {
					clientDataJSON: body.clientDataJSON,
					authenticatorData: body.authenticatorData,
					signature: body.signature,
				},
				expectedChallenge: stored.challenge,
				expectedOrigin: RP_ORIGIN,
				rpId: RP_ID,
				storedPublicKeyCose: new Uint8Array(cred.public_key),
				storedCounter: Number(cred.counter),
				requireUserVerification: REQUIRE_UV,
			});
		} catch (verifyError) {
			const reason = verifyError instanceof Error ? verifyError.message : 'verify_failed';
			if (reason.includes('counter')) logAuthEvent('passkey_counter_anomaly', { credentialId: cred.id });
			return fail(reason);
		}

		const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [cred.user_id]);
		const user = userResult.rows[0];
		if (!user || !user.is_active) return fail('account_inactive');

		// Write the counter back atomically — clone detection is inert without
		// the write, and a bare UPDATE has a read-verify-write race where two
		// concurrent assertions off a cloned authenticator both pass. The guard
		// only advances the counter (allowing the both-zero synced-passkey case),
		// and a no-op update means another request already advanced it: a clone
		// signal, so fail rather than issue a session.
		const upd = await query(
			`UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW()
			 WHERE id = $2 AND (counter < $1 OR counter = 0)`,
			[verified.newCounter, cred.id]
		);
		if ((upd.rowCount ?? 0) === 0) {
			logAuthEvent('passkey_counter_anomaly', { credentialId: cred.id });
			return fail('counter_race');
		}

		await establishSession(context, redis, user.id, 'passkey', user.username !== null);
		logAuthEvent('passkey_login', { userId: user.id, result: 'success' });
		return context.json({ user: userJson(user) });
	} catch (error) {
		console.error('Passkey login failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}

// ---- Registration ----

export async function handleWebauthnRegisterOptions(context: Context, redis: Redis): Promise<Response> {
	const userId = await getSessionUserId(context, redis);
	if (!userId) return context.json({ error: 'Not authenticated' }, 401);

	try {
		const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
		const user = userResult.rows[0];
		if (!user) return context.json({ error: 'User not found' }, 404);

		const existing = await query<{ credential_id: string; transports: string[] | null }>(
			'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
			[userId]
		);

		const { challengeId, challenge } = await storeChallenge(redis, { type: 'registration', userId });

		const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ')
			|| (user.username ?? user.email.split('@')[0]);

		return context.json({
			challengeId,
			options: {
				rp: { id: RP_ID, name: RP_NAME },
				user: {
					// user handle = utf8 of our UUID; checked back at login.
					id: toBase64url(new TextEncoder().encode(user.id)),
					name: user.email,
					displayName,
				},
				challenge,
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },   // ES256
					{ type: 'public-key', alg: -257 }, // RS256
				],
				timeout: 60000,
				attestation: 'none',
				excludeCredentials: existing.rows.map((r) => ({
					type: 'public-key',
					id: r.credential_id,
					transports: r.transports ?? undefined,
				})),
				authenticatorSelection: {
					residentKey: 'required',
					requireResidentKey: true,
					userVerification: 'required',
				},
			},
		});
	} catch (error) {
		console.error('Passkey register options failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Service unavailable' }, 503);
	}
}

interface RegisterVerifyBody {
	challengeId: string;
	clientDataJSON: string;
	attestationObject: string;
	transports?: string[];
	name?: string;
}

export async function handleWebauthnRegisterVerify(context: Context, redis: Redis): Promise<Response> {
	const userId = await getSessionUserId(context, redis);
	if (!userId) return context.json({ error: 'Not authenticated' }, 401);

	let body: RegisterVerifyBody;
	try {
		body = await context.req.json<RegisterVerifyBody>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	if (!body || typeof body !== 'object') return context.json({ error: 'Invalid request' }, 400);

	try {
		const stored = await consumeChallenge(redis, body.challengeId);
		// The registration challenge is bound to the user who requested it.
		if (!stored || stored.type !== 'registration' || stored.userId !== userId) {
			return context.json({ error: 'Invalid or expired challenge' }, 400);
		}

		// Cap credentials per user — bounds the table and the excludeCredentials
		// payload returned on every register/options call.
		const countResult = await query<{ count: string }>(
			'SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = $1',
			[userId]
		);
		if (Number(countResult.rows[0]?.count ?? 0) >= MAX_PASSKEYS_PER_USER) {
			return context.json({ error: `You can register at most ${MAX_PASSKEYS_PER_USER} passkeys` }, 409);
		}

		let verified;
		try {
			verified = verifyRegistration({
				response: { clientDataJSON: body.clientDataJSON, attestationObject: body.attestationObject },
				expectedChallenge: stored.challenge,
				expectedOrigin: RP_ORIGIN,
				rpId: RP_ID,
				requireUserVerification: REQUIRE_UV,
			});
		} catch (verifyError) {
			return context.json({ error: verifyError instanceof Error ? verifyError.message : 'Verification failed' }, 400);
		}

		const transports = Array.isArray(body.transports)
			? body.transports.filter((t) => typeof t === 'string').slice(0, 8)
			: null;
		const name = typeof body.name === 'string' && body.name.trim()
			? body.name.trim().slice(0, 255)
			: (verified.deviceType === 'multiDevice' ? 'Passkey' : 'Security key');

		try {
			const inserted = await query<{ id: string; name: string; created_at: Date }>(
				`INSERT INTO webauthn_credentials
					(user_id, credential_id, public_key, counter, transports, aaguid, device_type, backed_up, name)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				 RETURNING id, name, created_at`,
				[
					userId, verified.credentialId, Buffer.from(verified.publicKeyCose), verified.counter,
					transports, verified.aaguid, verified.deviceType, verified.backedUp, name,
				]
			);
			const row = inserted.rows[0]!;
			logAuthEvent('passkey_registered', { userId, credentialId: row.id });
			return context.json({ verified: true, credential: { id: row.id, name: row.name, created_at: row.created_at } }, 201);
		} catch (insertError) {
			if (insertError instanceof Error && 'code' in insertError && insertError.code === '23505') {
				return context.json({ error: 'This passkey is already registered' }, 409);
			}
			throw insertError;
		}
	} catch (error) {
		console.error('Passkey register verify failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Service unavailable' }, 503);
	}
}

// ---- Credential management ----

export async function handleListPasskeys(context: Context, redis: Redis): Promise<Response> {
	const userId = await getSessionUserId(context, redis);
	if (!userId) return context.json({ error: 'Not authenticated' }, 401);

	const result = await query<{
		id: string; name: string; device_type: string | null; backed_up: boolean;
		created_at: Date; last_used_at: Date | null;
	}>(
		`SELECT id, name, device_type, backed_up, created_at, last_used_at
		 FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
		[userId]
	);
	return context.json({ passkeys: result.rows });
}

interface RenameBody { name: string }

export async function handleRenamePasskey(context: Context, redis: Redis): Promise<Response> {
	const userId = await getSessionUserId(context, redis);
	if (!userId) return context.json({ error: 'Not authenticated' }, 401);

	const id = context.req.param('id');
	let body: RenameBody;
	try {
		body = await context.req.json<RenameBody>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name || name.length > 255) return context.json({ error: 'Invalid name' }, 400);

	// Ownership-scoped: only the owner can rename their credential.
	const result = await query(
		'UPDATE webauthn_credentials SET name = $1 WHERE id = $2 AND user_id = $3',
		[name, id, userId]
	);
	if ((result.rowCount ?? 0) === 0) return context.json({ error: 'Passkey not found' }, 404);
	return context.json({ success: true });
}

export async function handleDeletePasskey(context: Context, redis: Redis): Promise<Response> {
	const userId = await getSessionUserId(context, redis);
	if (!userId) return context.json({ error: 'Not authenticated' }, 401);

	const id = context.req.param('id');
	const result = await query(
		'DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2',
		[id, userId]
	);
	if ((result.rowCount ?? 0) === 0) return context.json({ error: 'Passkey not found' }, 404);
	logAuthEvent('passkey_removed', { userId, credentialId: id });
	return context.json({ success: true });
}
