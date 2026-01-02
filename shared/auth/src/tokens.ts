/**
 * Token utilities for email verification and password reset
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Token expiry duration (1 hour in milliseconds)
 */
export const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

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
