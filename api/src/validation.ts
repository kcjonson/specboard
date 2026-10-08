/**
 * Validation utilities
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DESCRIPTION_LENGTH = 2000;

export function isValidUUID(id: string | undefined): id is string {
	return id !== undefined && UUID_REGEX.test(id);
}

export function isValidOptionalUUID(value: string | undefined): boolean {
	if (value === undefined || value === '') return true;
	return isValidUUID(value);
}

export function isValidDescription(description: string): boolean {
	return description.length <= MAX_DESCRIPTION_LENGTH;
}

export function isValidDateFormat(dateStr: string): boolean {
	if (!DATE_REGEX.test(dateStr)) return false;
	const date = new Date(dateStr);
	return !isNaN(date.getTime());
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

export function normalizeOptionalString(value: string | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === '') return null;
	return value;
}
