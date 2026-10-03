const ITEM_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** The item `?focus=` names, normalized the way the planning route normalizes keys. */
export function readFocus(search: string): string | null {
	const value = new URLSearchParams(search).get('focus');
	return value && ITEM_KEY.test(value) ? value.toUpperCase() : null;
}

/** The same page with `focus` set to an item, or dropped for `null`. Everything else in the URL stays. */
export function urlWithFocus(location: { pathname: string; search: string; hash: string }, key: string | null): string {
	const params = new URLSearchParams(location.search);
	if (key) params.set('focus', key);
	else params.delete('focus');
	const search = params.toString();
	return location.pathname + (search ? `?${search}` : '') + location.hash;
}
