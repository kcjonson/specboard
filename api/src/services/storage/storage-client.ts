/**
 * HTTP client for calling the internal storage service.
 * Used by CloudStorageProvider for file operations in cloud mode.
 */

const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://storage.internal:3003';
const STORAGE_SERVICE_API_KEY = process.env.STORAGE_SERVICE_API_KEY;

interface StorageFile {
	path: string;
	contentHash: string;
	sizeBytes: number;
	syncedAt: string;
}

interface StorageFileContent extends StorageFile {
	content: string;
}

interface PendingChange {
	path: string;
	action: 'modified' | 'created' | 'deleted';
	hasContent: boolean;
	isLarge: boolean;
	updatedAt: string;
}

interface PendingChangeContent {
	path: string;
	content: string | null;
	action: 'modified' | 'created' | 'deleted';
	updatedAt: string;
}

/**
 * Storage service HTTP client.
 * All methods throw on error.
 */
export class StorageClient {
	private baseUrl: string;
	private apiKey: string;

	constructor(baseUrl?: string, apiKey?: string) {
		this.baseUrl = baseUrl || STORAGE_SERVICE_URL;
		this.apiKey = apiKey || STORAGE_SERVICE_API_KEY || '';

		if (!this.apiKey) {
			console.warn('STORAGE_SERVICE_API_KEY not set - storage service calls will fail');
		}
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		timeoutMs = 30000
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;

		// Add timeout to prevent indefinite hangs
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-API-Key': this.apiKey,
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({ error: 'Unknown error' }));
				throw new Error(`Storage service error: ${error.error || response.statusText}`);
			}

			return response.json() as Promise<T>;
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new Error(`Storage service timeout after ${timeoutMs}ms`);
			}
			throw err;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	// ============================================================
	// File Operations
	// ============================================================

	/**
	 * List all files for a project.
	 */
	async listFiles(projectId: string): Promise<StorageFile[]> {
		const result = await this.request<{ files: StorageFile[] }>(
			'GET',
			`/files/${projectId}`
		);
		return result.files;
	}

	/**
	 * Get file content.
	 */
	async getFile(projectId: string, path: string): Promise<StorageFileContent | null> {
		try {
			return await this.request<StorageFileContent>(
				'GET',
				`/files/${projectId}/${path}`
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes('not found')) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Store file content.
	 */
	async putFile(
		projectId: string,
		path: string,
		content: string,
		contentHash?: string
	): Promise<{ path: string; contentHash: string; sizeBytes: number }> {
		return this.request('PUT', `/files/${projectId}/${path}`, {
			content,
			contentHash,
		});
	}

	/**
	 * Delete file.
	 */
	async deleteFile(projectId: string, path: string): Promise<void> {
		await this.request('DELETE', `/files/${projectId}/${path}`);
	}

	// ============================================================
	// Pending Changes
	// ============================================================

	/**
	 * List pending changes for a user in a project.
	 */
	async listPendingChanges(projectId: string, userId: string): Promise<PendingChange[]> {
		const result = await this.request<{ changes: PendingChange[] }>(
			'GET',
			`/pending/${projectId}/${userId}`
		);
		return result.changes;
	}

	/**
	 * Get pending change content.
	 */
	async getPendingChange(
		projectId: string,
		userId: string,
		path: string
	): Promise<PendingChangeContent | null> {
		try {
			return await this.request<PendingChangeContent>(
				'GET',
				`/pending/${projectId}/${userId}/${path}`
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes('not found')) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Store pending change.
	 */
	async putPendingChange(
		projectId: string,
		userId: string,
		path: string,
		content: string | null,
		action: 'modified' | 'created' | 'deleted'
	): Promise<{ path: string; action: string; isLarge: boolean }> {
		return this.request('PUT', `/pending/${projectId}/${userId}/${path}`, {
			content,
			action,
		});
	}

	/**
	 * Delete pending change.
	 */
	async deletePendingChange(projectId: string, userId: string, path: string): Promise<void> {
		await this.request('DELETE', `/pending/${projectId}/${userId}/${path}`);
	}

	/**
	 * Delete all pending changes for a user in a project.
	 */
	async deleteAllPendingChanges(
		projectId: string,
		userId: string
	): Promise<{ deleted: boolean; count: number }> {
		return this.request('DELETE', `/pending/${projectId}/${userId}`);
	}
}

// Singleton instance
let storageClient: StorageClient | null = null;

export function getStorageClient(): StorageClient {
	if (!storageClient) {
		storageClient = new StorageClient();
	}
	return storageClient;
}
