/**
 * AES-256-GCM encryption utilities for storing sensitive data like API keys
 *
 * This is distinct from token hashing in tokens.ts:
 * - Hashing (tokens.ts): One-way transformation for tokens we verify but don't need to recover
 * - Encryption (this file): Reversible transformation for secrets we need to use (API keys)
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16; // 128 bits

// Cached encryption key to avoid repeated env reads and Buffer conversions
let cachedKey: Buffer | null = null;

export interface EncryptedData {
	ciphertext: string; // Base64 encoded
	iv: string; // Base64 encoded
	authTag: string; // Base64 encoded
}

/**
 * Get the encryption key from environment variable.
 * Key must be 32 bytes (256 bits) hex-encoded (64 characters).
 * Key is cached after first successful load.
 */
export function getEncryptionKey(): Buffer {
	if (cachedKey) {
		return cachedKey;
	}

	const keyHex = process.env.API_KEY_ENCRYPTION_KEY;
	if (!keyHex) {
		throw new Error('API_KEY_ENCRYPTION_KEY environment variable is not set');
	}

	if (keyHex.length !== 64) {
		throw new Error(
			'API_KEY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
		);
	}

	// Validate hex characters (0-9, a-f, A-F)
	if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
		throw new Error(
			'API_KEY_ENCRYPTION_KEY must contain only valid hex characters (0-9, a-f)'
		);
	}

	cachedKey = Buffer.from(keyHex, 'hex');
	return cachedKey;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns the ciphertext, IV, and authentication tag (all base64 encoded).
 */
export function encrypt(plaintext: string): EncryptedData {
	const key = getEncryptionKey();
	const iv = crypto.randomBytes(IV_LENGTH);

	const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});

	const encrypted = Buffer.concat([
		cipher.update(plaintext, 'utf8'),
		cipher.final(),
	]);

	const authTag = cipher.getAuthTag();

	return {
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		authTag: authTag.toString('base64'),
	};
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * Requires the ciphertext, IV, and authentication tag.
 */
export function decrypt(encrypted: EncryptedData): string {
	const key = getEncryptionKey();
	const iv = Buffer.from(encrypted.iv, 'base64');
	const authTag = Buffer.from(encrypted.authTag, 'base64');
	const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return decrypted.toString('utf8');
}

/**
 * Mask an API key for display (shows first 7 and last 4 characters).
 * e.g., "sk-ant-api03-abc...xyz" → "sk-ant-...x5Kg"
 */
export function maskApiKey(key: string): string {
	if (key.length <= 11) {
		return '****';
	}
	const prefix = key.slice(0, 7);
	const suffix = key.slice(-4);
	return `${prefix}...${suffix}`;
}
