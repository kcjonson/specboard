/**
 * HTTP client for calling the internal storage service.
 * Used by CloudStorageProvider for file operations in cloud mode.
 */

const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://storage.internal:3003';
const STORAGE_SERVICE_API_KEY = process.env.STORAGE_SERVICE_API_KEY;

/** Why a file on the branch has no content here: binary, or over the sync's size limit. */
export type UnavailableReason = 'too_large' | 'binary';

interface StorageFile {
	path: string;
	contentHash: string;
	sizeBytes: number;
	syncedAt: string;
	/** Set for a file on the branch the editor can't hold; it has no content here. */
	unavailable?: UnavailableReason | null;
}

/** A committed file: its content, or none when it's one the editor can't hold. */
type StorageFileContent = StorageFile & (
	| { content: string; unavailable?: null }
	| { content: null; unavailable: UnavailableReason }
);

interface PendingChange {
	path: string;
	action: 'modified' | 'created' | 'deleted';
	/** The committed path this change was renamed from, when it is the new side of a rename. */
	renamedFrom: string | null;
	/** What's committed at this path changed since the draft began (someone else's commit or a pull). */
	conflict: boolean;
	/** The committed version the draft was made against; null when none was committed. */
	baseContentHash: string | null;
	/** The draft's own content hash; null for a deletion. */
	contentHash: string | null;
	/** The committed file's hash at this path now; null when none is. */
	committedHash: string | null;
	hasContent: boolean;
	isLarge: boolean;
	updatedAt: string;
}

export interface PendingChangeContent {
	path: string;
	content: string | null;
	action: 'modified' | 'created' | 'deleted';
	renamedFrom: string | null;
	/** The committed version the draft was made against; null when none was committed. */
	baseContentHash: string | null;
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
				throw new Error(`Storage service timeout after ${timeoutMs}ms`, { cause: err });
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
	 * Store pending change. `renamedFrom` names the committed path a rename came from;
	 * null leaves any origin the change already has (a later save of a renamed file).
	 */
	async putPendingChange(
		projectId: string,
		userId: string,
		path: string,
		content: string | null,
		action: 'modified' | 'created' | 'deleted',
		renamedFrom: string | null,
		baseContentHash: string | null | undefined
	): Promise<{ path: string; action: string; isLarge: boolean }> {
		// Storage reads a missing baseContentHash key as "not known" and an explicit null
		// as "nothing was committed", so the key is only sent when there is one.
		return this.request('PUT', `/pending/${projectId}/${userId}/${path}`, {
			content,
			action,
			renamedFrom,
			...(baseContentHash === undefined ? {} : { baseContentHash }),
		});
	}

	/**
	 * Delete pending change.
	 */
	async deletePendingChange(projectId: string, userId: string, path: string): Promise<void> {
		await this.request('DELETE', `/pending/${projectId}/${userId}/${path}`);
	}

	/** Undo the user's rename of oldPath to newPath: both drafts dropped in one storage transaction. */
	async undoRename(projectId: string, userId: string, oldPath: string, newPath: string): Promise<void> {
		await this.request('POST', `/pending/${projectId}/${userId}/undo-rename`, { oldPath, newPath });
	}

	/**
	 * Keep the user's drafts at these paths over what's committed there now ("keep
	 * mine"): each draft's base becomes the current committed version.
	 */
	async rebasePendingChanges(
		projectId: string,
		userId: string,
		paths: string[]
	): Promise<{ rebased: string[]; dropped: string[] }> {
		return this.request('POST', `/pending/${projectId}/${userId}/rebase`, { paths });
	}

	/**
	 * Make a commit that GitHub accepted the project's committed files: write what it
	 * added and modified, remove what it deleted, and clear the committer's pending
	 * changes it took (one storage transaction). A pending change saved again since it
	 * was read for the commit stays pending.
	 */
	async promoteCommit(projectId: string, userId: string, changes: PendingChangeContent[]): Promise<void> {
		await this.request('POST', `/commits/${projectId}/${userId}`, {
			changes: changes.map((c) => ({ path: c.path, action: c.action, content: c.content, updatedAt: c.updatedAt })),
		});
	}

	/**
	 * List pending changes with their content.
	 * Used for committing changes to GitHub.
	 *
	 * Note: Fetches content in parallel using Promise.all. For typical documentation
	 * commits (< 50 files), this is efficient. If we ever need to handle very large
	 * changesets, consider implementing batching to avoid overwhelming the storage service.
	 */
	async listPendingChangesWithContent(
		projectId: string,
		userId: string
	): Promise<PendingChangeContent[]> {
		// Get the list of pending changes
		const changes = await this.listPendingChanges(projectId, userId);

		// Each change as its own read returns it, so content, action, and updatedAt agree
		// even if the user saved in between; one discarded since the listing is left out.
		const reads = await Promise.all(
			changes.map((change) => this.getPendingChange(projectId, userId, change.path))
		);
		return reads.filter((read): read is PendingChangeContent => read !== null);
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
