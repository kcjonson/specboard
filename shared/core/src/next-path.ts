/**
 * Where to send someone after a sign-in or onboarding step, taken from a `next` the
 * client supplied. Same-origin relative paths only, so a crafted link can't turn a
 * Specboard page into an open redirect.
 */

const MAX_NEXT_PATH_LENGTH = 2048;

/** The path when it is a safe same-origin relative path, else null. */
export function safeNextPath(next: unknown): string | null {
	if (typeof next !== 'string') return null;
	if (!next.startsWith('/') || next.startsWith('//') || next.length > MAX_NEXT_PATH_LENGTH) return null;
	// Browsers normalize a backslash to '/', so '/\evil.com' is '//evil.com' (off-site).
	// Control characters, NUL above all, would also make a stored next_path throw on INSERT.
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f\\]/.test(next)) return null;
	return next;
}
