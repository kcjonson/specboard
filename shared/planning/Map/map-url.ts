import { formatItemKey, parseItemKey } from '@specboard/core/identifiers';

/** The item `?focus=` names, in the canonical key form the rest of the app uses, or null if it names nothing valid. */
export function readFocus(search: string): string | null {
	const value = new URLSearchParams(search).get('focus');
	const parsed = value ? parseItemKey(value) : null;
	return parsed ? formatItemKey(parsed.projectKey, parsed.number) : null;
}

/** The same page with `focus` set to an item, or dropped for `null`. Everything else in the URL stays. */
export function urlWithFocus(location: { pathname: string; search: string; hash: string }, key: string | null): string {
	const params = new URLSearchParams(location.search);
	if (key) params.set('focus', key);
	else params.delete('focus');
	const search = params.toString();
	return location.pathname + (search ? `?${search}` : '') + location.hash;
}
