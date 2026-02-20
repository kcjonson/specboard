/**
 * @specboard/models - URL template utility
 *
 * Compiles path-to-regexp style URL templates.
 *
 * @example
 * compileUrl('/posts/:id', { id: 123 }) // => '/posts/123'
 * compileUrl('/users/:userId/posts/:postId', { userId: 1, postId: 5 }) // => '/users/1/posts/5'
 */

export function compileUrl(template: string, params: Record<string, string | number>): string {
	let url = template;

	for (const [key, value] of Object.entries(params)) {
		const encodedValue = encodeURIComponent(String(value));
		url = url.replaceAll(`:${key}`, encodedValue);
	}

	return url;
}
