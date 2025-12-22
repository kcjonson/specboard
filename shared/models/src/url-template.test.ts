/**
 * @doc-platform/models - URL template tests
 */

import { describe, it, expect } from 'vitest';
import { compileUrl } from './url-template';

describe('compileUrl', () => {
	it('should replace a single parameter', () => {
		const result = compileUrl('/posts/:id', { id: 123 });
		expect(result).toBe('/posts/123');
	});

	it('should replace multiple parameters', () => {
		const result = compileUrl('/users/:userId/posts/:postId', { userId: 1, postId: 5 });
		expect(result).toBe('/users/1/posts/5');
	});

	it('should replace all occurrences of the same parameter', () => {
		const result = compileUrl('/api/:id/nested/:id', { id: 42 });
		expect(result).toBe('/api/42/nested/42');
	});

	it('should URL-encode special characters', () => {
		const result = compileUrl('/search/:query', { query: 'hello world' });
		expect(result).toBe('/search/hello%20world');
	});

	it('should URL-encode special URL characters', () => {
		const result = compileUrl('/path/:value', { value: 'a/b?c=d&e=f' });
		expect(result).toBe('/path/a%2Fb%3Fc%3Dd%26e%3Df');
	});

	it('should handle numeric values', () => {
		const result = compileUrl('/items/:id', { id: 42 });
		expect(result).toBe('/items/42');
	});

	it('should handle string values', () => {
		const result = compileUrl('/users/:name', { name: 'john' });
		expect(result).toBe('/users/john');
	});

	it('should leave unreplaced params in the URL', () => {
		const result = compileUrl('/users/:id/posts/:postId', { id: 1 });
		expect(result).toBe('/users/1/posts/:postId');
	});

	it('should handle empty params object', () => {
		const result = compileUrl('/posts/:id', {});
		expect(result).toBe('/posts/:id');
	});

	it('should handle URL with no params', () => {
		const result = compileUrl('/posts', { id: 1 });
		expect(result).toBe('/posts');
	});
});
