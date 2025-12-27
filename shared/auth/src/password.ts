import bcrypt from 'bcrypt';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BCRYPT_COST = 12;
const MIN_LENGTH = 12;
const MAX_LENGTH = 512;

/**
 * Password validation error
 */
export interface PasswordValidationError {
	code: string;
	message: string;
}

/**
 * Password validation result
 */
export interface PasswordValidationResult {
	valid: boolean;
	errors: PasswordValidationError[];
}

// Load common passwords list once at module load
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const commonPasswordsPath = join(__dirname, 'common-passwords.txt');

let commonPasswords: Set<string>;
try {
	const content = readFileSync(commonPasswordsPath, 'utf-8');
	commonPasswords = new Set(content.split('\n').map((p) => p.trim().toLowerCase()));
} catch {
	// Fallback to empty set if file not found (e.g., in tests)
	commonPasswords = new Set();
}

/**
 * Validate a password against all requirements
 */
export function validatePassword(password: string): PasswordValidationResult {
	const errors: PasswordValidationError[] = [];

	// Length checks
	if (password.length < MIN_LENGTH) {
		errors.push({
			code: 'TOO_SHORT',
			message: `Password must be at least ${MIN_LENGTH} characters`,
		});
	}

	if (password.length > MAX_LENGTH) {
		errors.push({
			code: 'TOO_LONG',
			message: `Password must be at most ${MAX_LENGTH} characters`,
		});
	}

	// Complexity checks
	if (!/[A-Z]/.test(password)) {
		errors.push({
			code: 'NO_UPPERCASE',
			message: 'Password must contain at least one uppercase letter',
		});
	}

	if (!/[a-z]/.test(password)) {
		errors.push({
			code: 'NO_LOWERCASE',
			message: 'Password must contain at least one lowercase letter',
		});
	}

	if (!/[0-9]/.test(password)) {
		errors.push({
			code: 'NO_DIGIT',
			message: 'Password must contain at least one digit',
		});
	}

	if (!/[^A-Za-z0-9]/.test(password)) {
		errors.push({
			code: 'NO_SPECIAL',
			message: 'Password must contain at least one special character',
		});
	}

	// Common password check
	if (commonPasswords.has(password.toLowerCase())) {
		errors.push({
			code: 'COMMON_PASSWORD',
			message: 'This password is too common, please choose a different one',
		});
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(
	password: string,
	hash: string
): Promise<boolean> {
	return bcrypt.compare(password, hash);
}
