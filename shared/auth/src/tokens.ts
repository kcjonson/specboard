/**
 * Token utilities for email verification and password reset
 */

import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Token expiry duration (1 hour in milliseconds)
 */
export const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Magic link / sign-in code expiry (15 minutes in milliseconds)
 */
export const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Sign-in code alphabet: Crockford-style base32 without 0/O/1/I/L/U to avoid
 * transcription mistakes. 8 chars over 30 symbols is ~39 bits, which is only
 * safe combined with a per-token attempt cap and short expiry.
 */
export const LOGIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const LOGIN_CODE_LENGTH = 8;

const LOGIN_CODE_PATTERN = new RegExp(`^[${LOGIN_CODE_ALPHABET}]{${LOGIN_CODE_LENGTH}}$`);

/**
 * Generate a sign-in code (e.g. "KDWQ7R2M")
 */
export function generateLoginCode(): string {
	let code = '';
	for (let index = 0; index < LOGIN_CODE_LENGTH; index++) {
		code += LOGIN_CODE_ALPHABET[randomInt(LOGIN_CODE_ALPHABET.length)];
	}
	return code;
}

/**
 * Normalize user-typed code input: uppercase, strip separators/whitespace.
 * Returns null if the result is not a valid code shape.
 */
export function normalizeLoginCode(input: string): string | null {
	const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
	return LOGIN_CODE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Generate a secure random token
 * Returns a 64-character hex string (256 bits of entropy)
 */
export function generateToken(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Hash a token using SHA-256
 * Tokens are stored as hashes in the database for security
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare a token against a stored hash in constant time
 * Prevents timing attacks during token verification
 */
export function verifyToken(token: string, storedHash: string): boolean {
	const tokenHash = hashToken(token);

	// Use 'hex' encoding since both hashes are hex strings (64 chars -> 32 bytes)
	// This is more efficient and semantically correct than UTF-8 encoding
	const tokenBuffer = Buffer.from(tokenHash, 'hex');
	const storedBuffer = Buffer.from(storedHash, 'hex');

	if (tokenBuffer.length !== storedBuffer.length) {
		return false;
	}

	return timingSafeEqual(tokenBuffer, storedBuffer);
}

/**
 * Calculate token expiry timestamp
 */
export function getTokenExpiry(): Date {
	return new Date(Date.now() + TOKEN_EXPIRY_MS);
}

/**
 * Check if a token has expired
 */
export function isTokenExpired(expiresAt: Date): boolean {
	return new Date() > expiresAt;
}
