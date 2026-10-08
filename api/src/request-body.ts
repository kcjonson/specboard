/**
 * Reading a write's JSON body. Hono's req.json() throws on malformed JSON, which a
 * handler that doesn't catch it turns into a 500, and it resolves arrays, null,
 * strings, and numbers without complaint, which a handler reading fields off the
 * body either trips over or quietly reads as "nothing given".
 */

import type { Context } from 'hono';

/**
 * The request body when it is a JSON object, or a 400 Response to return as-is.
 * The fields are still unchecked: T only names what the handler goes on to validate.
 */
export async function jsonObjectBody<T extends object = Record<string, unknown>>(context: Context): Promise<T | Response> {
	let body: unknown;
	try {
		body = await context.req.json();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return context.json({ error: 'Request body must be a JSON object' }, 400);
	}
	return body as T;
}
