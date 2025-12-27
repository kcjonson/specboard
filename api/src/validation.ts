/**
 * Validation utilities
 */

import type { EpicStatus } from '@doc-platform/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES: EpicStatus[] = ['ready', 'in_progress', 'done'];

export const MAX_TITLE_LENGTH = 255;

export function isValidUUID(id: string): boolean {
	return UUID_REGEX.test(id);
}

export function isValidOptionalUUID(value: string | undefined): boolean {
	if (value === undefined || value === '') return true;
	return isValidUUID(value);
}

export function isValidStatus(status: unknown): status is EpicStatus {
	return typeof status === 'string' && VALID_STATUSES.includes(status as EpicStatus);
}

export function isValidTitle(title: string): boolean {
	return title.length > 0 && title.length <= MAX_TITLE_LENGTH;
}

export function isValidDateFormat(dateStr: string): boolean {
	if (!DATE_REGEX.test(dateStr)) return false;
	const date = new Date(dateStr);
	return !isNaN(date.getTime());
}

export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeOptionalString(value: string | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === '') return null;
	return value;
}
