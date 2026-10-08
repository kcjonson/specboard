import { formatItemKey, parseItemKey } from '@specboard/core/identifiers';
import { withQuery, type Address } from '../utils/address';

/** The item `?focus=` names, in the canonical key form the rest of the app uses, or null if it names nothing valid. */
export function readFocus(search: string): string | null {
	const value = new URLSearchParams(search).get('focus');
	const parsed = value ? parseItemKey(value) : null;
	return parsed ? formatItemKey(parsed.projectKey, parsed.number) : null;
}

/** The same page with `focus` set to an item, or dropped for `null`. Everything else in the URL stays as written. */
export function urlWithFocus(location: Address, key: string | null): string {
	return withQuery(location, { focus: key ?? undefined });
}
