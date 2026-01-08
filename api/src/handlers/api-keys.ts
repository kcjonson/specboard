/**
 * User API key management handlers
 *
 * Endpoints:
 * - GET /api/users/me/api-keys: List configured API keys (masked)
 * - POST /api/users/me/api-keys: Add new API key
 * - DELETE /api/users/me/api-keys/:provider: Remove API key
 * - POST /api/users/me/api-keys/:provider/validate: Validate API key works
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME, encrypt, decrypt, maskApiKey } from '@doc-platform/auth';
import { query, type UserApiKey, type ApiKeyProvider } from '@doc-platform/db';

const VALID_PROVIDERS: ApiKeyProvider[] = ['anthropic'];

function isValidProvider(provider: string): provider is ApiKeyProvider {
	return VALID_PROVIDERS.includes(provider as ApiKeyProvider);
}

/**
 * Get current user ID from session
 */
async function getUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	return session?.userId ?? null;
}

/**
 * API key response format (never exposes actual key)
 */
interface ApiKeyResponse {
	provider: ApiKeyProvider;
	key_name: string;
	masked_key: string;
	last_used_at: string | null;
	created_at: string;
}

/**
 * List user's configured API keys
 * GET /api/users/me/api-keys
 */
export async function handleListApiKeys(
	context: Context,
	redis: Redis
): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const result = await query<UserApiKey>(
			`SELECT * FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
			[userId]
		);

		// Use pre-computed masked_key from database (no decryption needed)
		const keys: ApiKeyResponse[] = result.rows.map(row => ({
			provider: row.provider,
			key_name: row.key_name,
			masked_key: row.masked_key || '****',
			last_used_at: row.last_used_at?.toISOString() ?? null,
			created_at: row.created_at.toISOString(),
		}));

		return context.json(keys);
	} catch (error) {
		console.error('Failed to list API keys:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

interface CreateApiKeyRequest {
	provider: string;
	key_name: string;
	api_key: string;
}

/**
 * Add a new API key
 * POST /api/users/me/api-keys
 */
export async function handleCreateApiKey(
	context: Context,
	redis: Redis
): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	let body: CreateApiKeyRequest;
	try {
		body = await context.req.json<CreateApiKeyRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { provider, key_name, api_key } = body;

	// Validate provider
	if (!provider || !isValidProvider(provider)) {
		return context.json(
			{ error: `Invalid provider. Valid providers: ${VALID_PROVIDERS.join(', ')}` },
			400
		);
	}

	// Validate key_name
	if (!key_name || key_name.trim().length === 0) {
		return context.json({ error: 'Key name is required' }, 400);
	}
	if (key_name.length > 255) {
		return context.json({ error: 'Key name too long (max 255 characters)' }, 400);
	}

	// Validate api_key
	if (!api_key || api_key.trim().length === 0) {
		return context.json({ error: 'API key is required' }, 400);
	}

	// Basic validation for Anthropic keys (they start with "sk-ant-")
	if (provider === 'anthropic' && !api_key.startsWith('sk-ant-')) {
		return context.json(
			{ error: 'Invalid Anthropic API key format (should start with sk-ant-)' },
			400
		);
	}

	try {
		// Encrypt the API key
		const encrypted = encrypt(api_key);
		const maskedKey = maskApiKey(api_key);

		// Upsert (replace if exists for this provider)
		await query(
			`INSERT INTO user_api_keys (user_id, provider, key_name, encrypted_key, iv, auth_tag, masked_key)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (user_id, provider) DO UPDATE SET
			 key_name = EXCLUDED.key_name,
			 encrypted_key = EXCLUDED.encrypted_key,
			 iv = EXCLUDED.iv,
			 auth_tag = EXCLUDED.auth_tag,
			 masked_key = EXCLUDED.masked_key,
			 updated_at = NOW()`,
			[userId, provider, key_name.trim(), encrypted.ciphertext, encrypted.iv, encrypted.authTag, maskedKey]
		);

		return context.json({
			provider,
			key_name: key_name.trim(),
			masked_key: maskedKey,
			last_used_at: null,
			created_at: new Date().toISOString(),
		}, 201);
	} catch (error) {
		console.error('Failed to create API key:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * Delete an API key
 * DELETE /api/users/me/api-keys/:provider
 */
export async function handleDeleteApiKey(
	context: Context,
	redis: Redis
): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const provider = context.req.param('provider');
	if (!isValidProvider(provider)) {
		return context.json({ error: 'Invalid provider' }, 400);
	}

	try {
		const result = await query(
			'DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		);

		if (result.rowCount === 0) {
			return context.json({ error: 'API key not found' }, 404);
		}

		return new Response(null, { status: 204 });
	} catch (error) {
		console.error('Failed to delete API key:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * Validate an API key works (tests against provider API)
 * POST /api/users/me/api-keys/:provider/validate
 */
export async function handleValidateApiKey(
	context: Context,
	redis: Redis
): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const provider = context.req.param('provider');
	if (!isValidProvider(provider)) {
		return context.json({ error: 'Invalid provider' }, 400);
	}

	try {
		// Get the stored key
		const result = await query<UserApiKey>(
			'SELECT * FROM user_api_keys WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		);

		const keyRecord = result.rows[0];
		if (!keyRecord) {
			return context.json({ error: 'API key not found' }, 404);
		}

		// Decrypt the key
		const apiKey = decrypt({
			ciphertext: keyRecord.encrypted_key,
			iv: keyRecord.iv,
			authTag: keyRecord.auth_tag,
		});

		// Validate based on provider
		if (provider === 'anthropic') {
			const valid = await validateAnthropicKey(apiKey);
			if (!valid) {
				return context.json({ valid: false, error: 'API key is invalid or expired' });
			}
		}

		// Update last_used_at
		await query(
			'UPDATE user_api_keys SET last_used_at = NOW() WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		);

		return context.json({ valid: true });
	} catch (error) {
		console.error('Failed to validate API key:', error);
		return context.json({ error: 'Validation failed' }, 500);
	}
}

/**
 * Validate an Anthropic API key by making a simple API call
 */
async function validateAnthropicKey(apiKey: string): Promise<boolean> {
	try {
		// Make a minimal request to check if the key is valid
		// Using the messages API with max_tokens=1 to minimize cost
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: 'claude-3-haiku-20240307',
				max_tokens: 1,
				messages: [{ role: 'user', content: 'hi' }],
			}),
		});

		// 200 = valid key
		// 401 = invalid key
		// Other errors might be rate limits, etc. - treat as valid key for now
		if (response.status === 401) {
			return false;
		}

		return true;
	} catch {
		// Network error - can't validate, but key might be valid
		return true;
	}
}

/**
 * Get a user's decrypted API key for a provider (internal use only)
 * Returns null if not found or decryption fails
 */
export async function getDecryptedApiKey(
	userId: string,
	provider: ApiKeyProvider
): Promise<string | null> {
	try {
		const result = await query<UserApiKey>(
			'SELECT * FROM user_api_keys WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		);

		const keyRecord = result.rows[0];
		if (!keyRecord) {
			return null;
		}

		let apiKey: string;
		try {
			apiKey = decrypt({
				ciphertext: keyRecord.encrypted_key,
				iv: keyRecord.iv,
				authTag: keyRecord.auth_tag,
			});
		} catch (decryptError) {
			// Log decryption failures as security events (possible tampering or key rotation)
			console.error('API key decryption failed - possible tampering or key rotation:', {
				userId,
				provider,
				keyId: keyRecord.id,
				error: decryptError instanceof Error ? decryptError.message : 'Unknown error',
			});
			return null;
		}

		// Update last_used_at asynchronously (fire-and-forget to reduce latency)
		query(
			'UPDATE user_api_keys SET last_used_at = NOW() WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		).catch(err => {
			console.error('Failed to update last_used_at:', err);
		});

		return apiKey;
	} catch (error) {
		console.error('Failed to get API key:', error);
		return null;
	}
}
