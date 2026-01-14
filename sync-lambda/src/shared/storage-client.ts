/**
 * Shared storage client for sync operations.
 */

export interface StorageClient {
	putFile(projectId: string, path: string, content: string): Promise<void>;
	deleteFile?(projectId: string, path: string): Promise<void>;
}

/**
 * Retry a function with exponential backoff.
 * Does not retry on 4xx errors (client errors).
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries = 3,
	baseDelayMs = 1000
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			// Don't retry on 4xx errors (check error message for status codes)
			if (lastError.message.match(/\b4\d{2}\b/)) {
				throw lastError;
			}

			// Last attempt failed, throw
			if (attempt === maxRetries) {
				throw lastError;
			}

			// Exponential backoff: 1s, 2s, 4s
			const delay = baseDelayMs * Math.pow(2, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

/**
 * Create a storage client that calls the storage service HTTP API.
 * Includes retry logic with exponential backoff.
 */
export function createStorageClient(
	storageServiceUrl: string,
	storageApiKey: string
): StorageClient & { deleteFile: (projectId: string, path: string) => Promise<void> } {
	return {
		async putFile(projectId: string, path: string, content: string): Promise<void> {
			await withRetry(async () => {
				const response = await fetch(
					`${storageServiceUrl}/files/${projectId}/${path}`,
					{
						method: 'PUT',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-API-Key': storageApiKey,
						},
						body: JSON.stringify({ content }),
					}
				);

				if (!response.ok) {
					const error = await response.json().catch(() => ({}));
					const message = (error as { error?: string })?.error || response.statusText;
					throw new Error(`${response.status}: ${message || 'Storage service request failed'}`);
				}
			});
		},

		async deleteFile(projectId: string, path: string): Promise<void> {
			await withRetry(async () => {
				const response = await fetch(
					`${storageServiceUrl}/files/${projectId}/${path}`,
					{
						method: 'DELETE',
						headers: {
							'X-Internal-API-Key': storageApiKey,
						},
					}
				);

				// Ignore 404 errors - file may not exist
				if (!response.ok && response.status !== 404) {
					const error = await response.json().catch(() => ({}));
					const message = (error as { error?: string })?.error || response.statusText;
					throw new Error(`${response.status}: ${message || 'Storage service request failed'}`);
				}
			});
		},
	};
}
