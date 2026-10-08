/** The parts of a location a planning view's address is made of. */
export interface Address {
	pathname: string;
	search: string;
	hash: string;
}

/** Slashes and commas are legal in a query and read back the same, so they stay bare, as a projects list needs. */
function parameter(name: string, value: string): string {
	return `${name}=${encodeURIComponent(value).replace(/%2F/g, '/').replace(/%2C/g, ',')}`;
}

/**
 * The address with some query parameters set, or dropped where the value is undefined.
 * Every other parameter stays exactly as written rather than being decoded and encoded
 * again, so the multi-project view's `projects=owner/a,owner/b` keeps its bare commas and
 * slashes (multi-project-view.md, decision 2). A parameter already there keeps its place;
 * a new one goes on the end.
 */
export function withQuery(address: Address, changes: Readonly<Record<string, string | undefined>>): string {
	const done = new Set<string>();
	const parts: string[] = [];
	for (const part of address.search.replace(/^\?/, '').split('&')) {
		if (part === '') continue;
		const name = part.split('=', 1)[0]!;
		if (!Object.hasOwn(changes, name)) {
			parts.push(part);
			continue;
		}
		if (done.has(name)) continue;
		done.add(name);
		const value = changes[name];
		if (value !== undefined) parts.push(parameter(name, value));
	}
	for (const [name, value] of Object.entries(changes)) {
		if (!done.has(name) && value !== undefined) parts.push(parameter(name, value));
	}
	return address.pathname + (parts.length > 0 ? `?${parts.join('&')}` : '') + address.hash;
}
