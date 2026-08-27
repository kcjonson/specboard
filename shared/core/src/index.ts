/**
 * @specboard/core
 * Shared types and utilities used across the platform.
 */

export const VERSION = '0.0.1';

// Error reporting
export { reportError, captureException, installErrorHandlers, type ErrorReport } from './error-reporting.ts';

// Logging
export { log, logRequest, type LogLevel } from './logging.ts';

/**
 * Creates a unique identifier.
 */
export function createId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep clones an object.
 */
export function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Debounces a function call.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	ms: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timeoutId) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), ms);
	};
}

function trimTrailingSlashes(value: string): string {
	// Index scan rather than /\/+$/: that pattern is unanchored at the start, so the
	// engine retries from every offset and goes quadratic on a mostly-slash segment.
	let end = value.length;
	while (end > 0 && value[end - 1] === '/') end--;
	return value.slice(0, end);
}

/**
 * Joins path segments into a single path.
 * Handles leading/trailing slashes and normalizes the result.
 *
 * @param segments - Path segments to join
 * @returns Normalized path string
 */
export function joinPath(...segments: string[]): string {
	return segments
		.map((segment, index) => {
			let s = trimTrailingSlashes(segment);
			// Remove leading slash from all but first segment
			if (index > 0) {
				s = s.replace(/^\/+/, '');
			}
			return s;
		})
		.filter(Boolean)
		.join('/');
}
