/**
 * Validation utilities
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_DESCRIPTION_LENGTH = 2000;

export function isValidUUID(id: string | undefined): id is string {
	return id !== undefined && UUID_REGEX.test(id);
}

export function isValidDescription(description: string): boolean {
	return description.length <= MAX_DESCRIPTION_LENGTH;
}

export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate username: 3-30 chars, alphanumeric and underscores only
 */
export function isValidUsername(username: string): boolean {
	return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}
