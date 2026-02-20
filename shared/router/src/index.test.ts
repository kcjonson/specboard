/**
 * @specboard/router - Tests
 */

import { describe, it, expect } from 'vitest';

// Since matchRoute is internal, we test it via startRouter behavior
// But we can also test the matching logic by extracting it for unit tests

describe('route matching', () => {
	// Extract matching logic for unit testing
	function matchRoute(
		pathname: string,
		routes: Array<{ route: string }>
	): { route: { route: string }; params: Record<string, string> } | null {
		const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');

		for (const route of routes) {
			const pattern = route.route === '/' ? '/' : route.route.replace(/\/$/, '');
			const patternParts = pattern.split('/').filter(Boolean);
			const pathParts = path.split('/').filter(Boolean);

			if (patternParts.length !== pathParts.length) continue;

			const params: Record<string, string> = {};
			let matched = true;

			for (let i = 0; i < patternParts.length; i++) {
				const patternPart = patternParts[i] as string;
				const pathPart = pathParts[i] as string;

				if (patternPart.startsWith(':')) {
					params[patternPart.slice(1)] = decodeURIComponent(pathPart);
				} else if (patternPart !== pathPart) {
					matched = false;
					break;
				}
			}

			if (matched) {
				return { route, params };
			}
		}

		return null;
	}

	describe('static routes', () => {
		it('should match root path', () => {
			const routes = [{ route: '/' }];
			const result = matchRoute('/', routes);

			expect(result).not.toBeNull();
			expect(result?.route.route).toBe('/');
			expect(result?.params).toEqual({});
		});

		it('should match simple path', () => {
			const routes = [{ route: '/login' }];
			const result = matchRoute('/login', routes);

			expect(result).not.toBeNull();
			expect(result?.route.route).toBe('/login');
		});

		it('should match nested path', () => {
			const routes = [{ route: '/users/settings' }];
			const result = matchRoute('/users/settings', routes);

			expect(result).not.toBeNull();
			expect(result?.route.route).toBe('/users/settings');
		});

		it('should return null for non-matching path', () => {
			const routes = [{ route: '/login' }];
			const result = matchRoute('/signup', routes);

			expect(result).toBeNull();
		});

		it('should match first route when multiple match', () => {
			const routes = [{ route: '/about' }, { route: '/about' }];
			const result = matchRoute('/about', routes);

			expect(result?.route).toBe(routes[0]);
		});
	});

	describe('dynamic routes', () => {
		it('should match single param', () => {
			const routes = [{ route: '/users/:id' }];
			const result = matchRoute('/users/123', routes);

			expect(result).not.toBeNull();
			expect(result?.params).toEqual({ id: '123' });
		});

		it('should match multiple params', () => {
			const routes = [{ route: '/posts/:postId/comments/:commentId' }];
			const result = matchRoute('/posts/42/comments/7', routes);

			expect(result).not.toBeNull();
			expect(result?.params).toEqual({ postId: '42', commentId: '7' });
		});

		it('should decode URI components', () => {
			const routes = [{ route: '/search/:query' }];
			const result = matchRoute('/search/hello%20world', routes);

			expect(result?.params).toEqual({ query: 'hello world' });
		});

		it('should not match if segment count differs', () => {
			const routes = [{ route: '/users/:id' }];
			const result = matchRoute('/users/123/posts', routes);

			expect(result).toBeNull();
		});
	});

	describe('trailing slashes', () => {
		it('should match path with trailing slash', () => {
			const routes = [{ route: '/about' }];
			const result = matchRoute('/about/', routes);

			expect(result).not.toBeNull();
		});

		it('should match pattern with trailing slash', () => {
			const routes = [{ route: '/about/' }];
			const result = matchRoute('/about', routes);

			expect(result).not.toBeNull();
		});
	});

	describe('route priority', () => {
		it('should match static before dynamic', () => {
			const routes = [{ route: '/users/me' }, { route: '/users/:id' }];
			const result = matchRoute('/users/me', routes);

			expect(result?.route.route).toBe('/users/me');
			expect(result?.params).toEqual({});
		});

		it('should match dynamic if static does not match', () => {
			const routes = [{ route: '/users/me' }, { route: '/users/:id' }];
			const result = matchRoute('/users/123', routes);

			expect(result?.route.route).toBe('/users/:id');
			expect(result?.params).toEqual({ id: '123' });
		});
	});
});
