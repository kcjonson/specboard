/**
 * Human-friendly identifiers for projects and work items.
 *
 * A project is addressed by its `slug` ("specboard") in every URL and API path.
 * A work item is addressed by its key — the project's short uppercase `key`
 * joined to a per-project sequential number, JIRA-style: `SB-345`.
 *
 * Slugs and keys are unique per owner, matching the access-control scope, so both
 * resolve unambiguously for the signed-in user.
 */

/** Longest a project slug may be. Leaves room for a dedupe suffix under the column's 63. */
export const MAX_PROJECT_SLUG_LENGTH = 55;

/** Project keys are 2-10 chars: a leading letter so `KEY-123` parses, then alphanumerics. */
export const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

/** Slugs are hyphen-separated alphanumeric groups: no leading, trailing, or doubled hyphens. */
export const PROJECT_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Item keys look like `SB-345`. */
const ITEM_KEY_REGEX = /^([A-Z][A-Z0-9]{1,9})-([0-9]{1,9})$/;

/** Used when a name yields nothing usable (punctuation-only, or a leading digit). */
const FALLBACK_SLUG = 'project';
const FALLBACK_KEY = 'PRJ';

/** Split a name into its alphanumeric words. */
function words(name: string): string[] {
	return name.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/**
 * Derive a URL slug from a project name: lowercase, non-alphanumerics collapsed to
 * single hyphens, trimmed and capped. Returns `project` when nothing usable remains.
 */
export function slugifyProjectName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_PROJECT_SLUG_LENGTH)
		.replace(/-+$/, '');
	return slug || FALLBACK_SLUG;
}

/**
 * Derive a short project key from a project name, JIRA-style: initials for a
 * multi-word name ("Dual Deck Builder" -> DDB), the first three characters for a
 * single word ("Specboard" -> SPE). Keys are a default, not a verdict — they're
 * editable, which is how "Specboard" becomes "SB" if that's what you want.
 */
export function deriveProjectKey(name: string): string {
	const parts = words(name);
	if (parts.length === 0) return FALLBACK_KEY;

	const derived = parts.length > 1
		? parts.slice(0, 5).map((word) => word[0]).join('').toUpperCase()
		: parts[0]!.slice(0, 3).toUpperCase();

	return PROJECT_KEY_REGEX.test(derived) ? derived : FALLBACK_KEY;
}

export function isValidProjectSlug(slug: unknown): slug is string {
	return typeof slug === 'string'
		&& slug.length <= MAX_PROJECT_SLUG_LENGTH
		&& PROJECT_SLUG_REGEX.test(slug);
}

export function isValidProjectKey(key: unknown): key is string {
	return typeof key === 'string' && PROJECT_KEY_REGEX.test(key);
}

/** Build an item's key from its project's key and its per-project number. */
export function formatItemKey(projectKey: string, number: number): string {
	return `${projectKey}-${number}`;
}

/**
 * Parse an item key into its parts, or null if it isn't one. Input is uppercased
 * first, so a hand-typed `sb-345` in the address bar resolves the same as `SB-345`.
 */
export function parseItemKey(key: string): { projectKey: string; number: number } | null {
	const match = ITEM_KEY_REGEX.exec(key.trim().toUpperCase());
	if (!match) return null;

	const number = Number(match[2]);
	if (!Number.isSafeInteger(number) || number < 1) return null;

	return { projectKey: match[1]!, number };
}

/**
 * Append or bump a numeric suffix so a derived identifier can dodge a collision:
 * `docs` -> `docs-2` -> `docs-3`, `DOC` -> `DOC2` -> `DOC3`.
 */
export function withSuffix(base: string, attempt: number, style: 'slug' | 'key'): string {
	if (attempt < 2) return base;
	const suffix = String(attempt);
	return style === 'slug'
		? `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length - 1)}-${suffix}`
		: `${base.slice(0, 10 - suffix.length)}${suffix}`;
}
