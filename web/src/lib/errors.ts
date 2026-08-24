import { FetchError } from '@specboard/fetch';

/**
 * Pull the server's friendly message out of a failed request. `FetchError.data`
 * is `unknown` and the API puts the message at `.error`; `err.message` is only
 * the bare "HTTP 409: Conflict". Falls back to `fallback` for anything else.
 */
export function fetchErrorText(err: unknown, fallback: string): string {
	if (err instanceof FetchError) {
		const data = err.data as { error?: string } | undefined;
		if (data?.error) return data.error;
	}
	return fallback;
}
