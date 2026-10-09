/**
 * Shared storage client for sync operations.
 */

export interface StorageClient {
	putFile(projectId: string, path: string, content: string): Promise<void>;
	deleteFile(projectId: string, path: string): Promise<void>;
	/** Every committed file's path. */
	listFiles(projectId: string): Promise<string[]>;
	/**
	 * Record a file on the branch the editor can't hold (binary, or over the size limit):
	 * its row keeps a hash of the new version and drops any older content.
	 */
	markUnavailable(projectId: string, path: string, reason: 'too_large' | 'binary', contentHash: string, sizeBytes: number): Promise<void>;
}

/** A storage service answer other than success, with what's needed to decide on a retry. */
export class StorageRequestError extends Error {
	readonly status: number;
	/** From Retry-After on a 429, when the service sent one. */
	readonly retryAfterMs: number | null;

	constructor(message: string, status: number, retryAfterMs: number | null) {
		super(message);
		this.name = 'StorageRequestError';
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

export interface RetryOptions {
	/** Retries for a server error or a dropped connection. */
	maxRetries: number;
	/** Retries for a 429: a sync bursting past the limit waits its turn rather than failing. */
	maxRateLimitRetries: number;
	baseDelayMs: number;
	/** Longest single wait, whatever Retry-After says. */
	maxDelayMs: number;
	sleep: (ms: number) => Promise<void>;
	/** Called with each wait before it starts; throwing ends the retrying (the caller is out of time). */
	beforeSleep?: (ms: number) => void;
}

const DEFAULT_RETRY: RetryOptions = {
	maxRetries: 3,
	maxRateLimitRetries: 8,
	baseDelayMs: 1000,
	maxDelayMs: 60_000,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Retry a request with exponential backoff. A 429 waits as long as Retry-After says (or
 * the backoff, if it says nothing) and has its own, larger budget; any other 4xx is the
 * request's fault and isn't retried.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
	const { maxRetries, maxRateLimitRetries, baseDelayMs, maxDelayMs, sleep, beforeSleep } = { ...DEFAULT_RETRY, ...options };
	let retries = 0;
	let rateLimitRetries = 0;

	for (;;) {
		try {
			return await fn();
		} catch (err) {
			const status = err instanceof StorageRequestError ? err.status : null;
			if (status === 429) {
				if (rateLimitRetries >= maxRateLimitRetries) throw err;
				const backoff = baseDelayMs * Math.pow(2, rateLimitRetries);
				rateLimitRetries++;
				const wait = Math.min((err as StorageRequestError).retryAfterMs ?? backoff, maxDelayMs);
				beforeSleep?.(wait);
				await sleep(wait);
				continue;
			}
			if (status !== null && status >= 400 && status < 500) throw err;
			if (retries >= maxRetries) throw err;
			const delay = Math.min(baseDelayMs * Math.pow(2, retries), maxDelayMs);
			retries++;
			beforeSleep?.(delay);
			await sleep(delay);
		}
	}
}

/**
 * A path as it goes into a storage URL: each segment encoded, so `#`, `?`, `%`, spaces,
 * and non-ASCII names reach the service as the path they are.
 */
export function storageUrlPath(path: string): string {
	return path.split('/').map(encodeURIComponent).join('/');
}

/** Retry-After in milliseconds: seconds, or an HTTP date; null when absent or unreadable. */
function retryAfterMs(header: string | null): number | null {
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Create a storage client that calls the storage service HTTP API.
 * Includes retry logic with exponential backoff.
 */
export function createStorageClient(
	storageServiceUrl: string,
	storageApiKey: string,
	retry: Partial<RetryOptions> = {}
): StorageClient {
	/**
	 * One request, as a sync makes it: identified as sync traffic, which the storage
	 * service rate-limits separately from the API's interactive requests.
	 */
	const request = async (method: string, urlPath: string, body?: unknown, { allow404 = false } = {}): Promise<Response> =>
		withRetry(async () => {
			const response = await fetch(`${storageServiceUrl}${urlPath}`, {
				method,
				headers: {
					'X-Internal-API-Key': storageApiKey,
					'X-Storage-Client': 'sync',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
			if (response.ok || (allow404 && response.status === 404)) return response;
			const error = await response.json().catch(() => ({}));
			const message = (error as { error?: string })?.error || response.statusText;
			throw new StorageRequestError(
				`${response.status}: ${message || 'Storage service request failed'}`,
				response.status,
				response.status === 429 ? retryAfterMs(response.headers.get('Retry-After')) : null
			);
		}, retry);

	return {
		async putFile(projectId: string, path: string, content: string): Promise<void> {
			await request('PUT', `/files/${projectId}/${storageUrlPath(path)}`, { content });
		},

		async markUnavailable(
			projectId: string,
			path: string,
			reason: 'too_large' | 'binary',
			contentHash: string,
			sizeBytes: number
		): Promise<void> {
			await request('POST', `/files/${projectId}/unavailable`, { path, reason, contentHash, sizeBytes });
		},

		async listFiles(projectId: string): Promise<string[]> {
			const response = await request('GET', `/files/${projectId}`);
			const body = (await response.json()) as { files: Array<{ path: string }> };
			return body.files.map((file) => file.path);
		},

		async deleteFile(projectId: string, path: string): Promise<void> {
			// A file that's already gone is what a delete wants.
			await request('DELETE', `/files/${projectId}/${storageUrlPath(path)}`, undefined, { allow404: true });
		},
	};
}
