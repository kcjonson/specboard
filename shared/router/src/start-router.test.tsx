/**
 * startRouter against a real location
 *
 * The frontend server's /admin gate compares Hono's percent-decoded path, so
 * it relies on the router never matching a static segment through an
 * encoding Hono leaves encoded (%25, %2F), or through any encoding at all.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { startRouter } from './index.tsx';

function rendered(path: string): string | null {
	window.history.replaceState(null, '', window.location.origin + path);
	const container = document.createElement('div');
	const stop = startRouter(
		[{ route: '/admin/ui', entry: () => <p>admin ui</p> }],
		container,
		() => <p>not found</p>
	);
	stop();
	return container.textContent;
}

describe('startRouter static segments', () => {
	it.each(['/admin/ui', '//admin/ui', '/admin//ui', '/x/%2e%2e/admin/ui'])('renders the route for %s', (path) => {
		expect(rendered(path)).toBe('admin ui');
	});

	it.each(['/%61dmin/ui', '/%2561dmin/ui', '/admin%2Fui', '/%61dmin%2Fui'])('does not decode %s into the route', (path) => {
		expect(rendered(path)).toBe('not found');
	});
});
