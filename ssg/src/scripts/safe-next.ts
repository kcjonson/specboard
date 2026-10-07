/**
 * `safeNext(next)` as source for the pages' inline scripts: a client-supplied
 * post-sign-in path when it stays on this origin, else '/'. The browser-side twin of
 * safeNextPath in @specboard/core, which the API applies to the same values.
 */
export const safeNextScript = `function safeNext(next) {
	if (typeof next !== 'string' || !next) return '/';
	try {
		var url = new URL(next, window.location.origin);
		if (url.origin !== window.location.origin) return '/';
		// A scheme-relative pathname ('//host' or '/\\\\host', which URL normalizes
		// to '//host') passes the origin check but navigates off-site.
		if (url.pathname.indexOf('//') === 0) return '/';
		return url.pathname + url.search + url.hash;
	} catch (e) {
		return '/';
	}
}`;
