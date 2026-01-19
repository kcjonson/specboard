/**
 * Cloud storage provider using internal storage service + GitHub API.
 * Used for web/cloud deployments where we can't access the local filesystem.
 */

import { StorageClient, getStorageClient } from './storage-client.ts';
import type {
	StorageProvider,
	FileEntry,
	ListDirectoryOptions,
	GitStatus,
	Commit,
	PullResult,
} from './types.ts';

/**
 * Cloud storage provider implementation.
 *
 * File operations: Uses internal storage service (S3 + Postgres)
 * Git operations: Uses GitHub API (to be implemented in GitHub sync handlers)
 *
 * NOTE: Git operations are stubs - actual implementation requires GitHub OAuth
 * tokens and will be handled by dedicated sync handlers.
 */
export class CloudStorageProvider implements StorageProvider {
	private projectId: string;
	private userId: string;
	private client: StorageClient;
	private repositoryOwner: string | null = null;
	private repositoryName: string | null = null;
	private defaultBranch: string = 'main';

	constructor(
		projectId: string,
		userId: string,
		options?: {
			repositoryOwner?: string;
			repositoryName?: string;
			defaultBranch?: string;
		}
	) {
		this.projectId = projectId;
		this.userId = userId;
		this.client = getStorageClient();

		if (options) {
			this.repositoryOwner = options.repositoryOwner || null;
			this.repositoryName = options.repositoryName || null;
			this.defaultBranch = options.defaultBranch || 'main';
		}
	}

	// ============================================================
	// File Operations (via Storage Service)
	// ============================================================

	async listDirectory(
		relativePath: string,
		options?: ListDirectoryOptions
	): Promise<FileEntry[]> {
		const files = await this.client.listFiles(this.projectId);

		// Build a virtual directory listing from flat file list
		// Storage paths don't have leading slashes, but API paths do (e.g., "/docs/file.md")
		// Normalize the input path to match storage format (no leading slash)
		let normalizedPath = relativePath;
		if (normalizedPath.startsWith('/')) {
			normalizedPath = normalizedPath.slice(1);
		}

		// For root directory or empty path, use empty prefix; otherwise add trailing slash
		const prefix = normalizedPath === '' || normalizedPath === '.' ? '' : `${normalizedPath}/`;
		const entries = new Map<string, FileEntry>();

		for (const file of files) {
			if (!file.path.startsWith(prefix)) continue;

			const remainingPath = file.path.slice(prefix.length);
			const slashIndex = remainingPath.indexOf('/');

			if (slashIndex === -1) {
				// This is a file in the current directory
				const name = remainingPath;

				// Apply filters
				if (!options?.showHidden && name.startsWith('.')) continue;
				if (options?.extensions) {
					// Extract extension properly - handle files without extensions
					const lastDotIndex = name.lastIndexOf('.');
					const ext = lastDotIndex > 0 && lastDotIndex < name.length - 1
						? name.slice(lastDotIndex + 1)
						: '';
					if (!options.extensions.includes(ext)) continue;
				}

				// Return paths with leading slash to match API convention
				entries.set(name, {
					name,
					path: '/' + file.path,
					type: 'file',
					size: file.sizeBytes,
					modifiedAt: new Date(file.syncedAt),
				});
			} else {
				// This is a subdirectory
				const dirName = remainingPath.slice(0, slashIndex);

				if (!options?.showHidden && dirName.startsWith('.')) continue;

				if (!entries.has(dirName)) {
					// Return paths with leading slash to match API convention
					entries.set(dirName, {
						name: dirName,
						path: '/' + prefix + dirName,
						type: 'directory',
					});
				}
			}
		}

		// Sort: directories first, then alphabetically
		return Array.from(entries.values()).sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	}

	async readFile(relativePath: string): Promise<string> {
		// Normalize path: API uses leading slash, storage doesn't
		const storagePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		// Check for pending changes first
		const pending = await this.client.getPendingChange(
			this.projectId,
			this.userId,
			storagePath
		);

		if (pending && pending.action !== 'deleted' && pending.content !== null) {
			return pending.content;
		}

		// Read from committed files
		const file = await this.client.getFile(this.projectId, storagePath);
		if (!file) {
			throw new Error(`File not found: ${relativePath}`);
		}

		return file.content;
	}

	async writeFile(relativePath: string, content: string): Promise<void> {
		// Normalize path: API uses leading slash, storage doesn't
		const storagePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		// Store as pending change (autosave)
		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storagePath,
			content,
			'modified'
		);
	}

	async deleteFile(relativePath: string): Promise<void> {
		// Normalize path: API uses leading slash, storage doesn't
		const storagePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		// Store as pending deletion
		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storagePath,
			null,
			'deleted'
		);
	}

	async createDirectory(_relativePath: string): Promise<void> {
		// Directories are implicit in S3/storage - no-op
		// Files create their parent directories automatically
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		// Normalize paths: API uses leading slash, storage doesn't
		const storageOldPath = oldPath.startsWith('/') ? oldPath.slice(1) : oldPath;
		const storageNewPath = newPath.startsWith('/') ? newPath.slice(1) : newPath;

		// Read old file, write to new path, delete old
		const content = await this.readFile(oldPath);
		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storageNewPath,
			content,
			'created'
		);
		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storageOldPath,
			null,
			'deleted'
		);
	}

	async exists(relativePath: string): Promise<boolean> {
		// Normalize path: API uses leading slash, storage doesn't
		const storagePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		// Check pending changes first
		const pending = await this.client.getPendingChange(
			this.projectId,
			this.userId,
			storagePath
		);

		if (pending) {
			return pending.action !== 'deleted';
		}

		// Check committed files
		const file = await this.client.getFile(this.projectId, storagePath);
		return file !== null;
	}

	// ============================================================
	// Git Operations (via GitHub API - stubs)
	// These will be implemented in dedicated GitHub sync handlers
	// ============================================================

	async status(): Promise<GitStatus> {
		// Get pending changes as the "uncommitted" status
		const pending = await this.client.listPendingChanges(this.projectId, this.userId);

		const staged: GitStatus['staged'] = [];
		const unstaged: GitStatus['unstaged'] = [];

		for (const change of pending) {
			const status =
				change.action === 'created'
					? 'added'
					: change.action === 'deleted'
						? 'deleted'
						: 'modified';

			// Return paths with leading slash to match API convention
			unstaged.push({
				path: '/' + change.path,
				status,
			});
		}

		return {
			branch: this.defaultBranch,
			ahead: 0,
			behind: 0,
			staged,
			unstaged,
			untracked: [],
		};
	}

	async log(_options?: { limit?: number; path?: string }): Promise<Commit[]> {
		// TODO: Implement via GitHub API
		// GET /repos/{owner}/{repo}/commits
		console.warn('CloudStorageProvider.log() not implemented - requires GitHub API');
		return [];
	}

	async add(_paths: string[]): Promise<void> {
		// In cloud mode, files are already "staged" when written as pending changes
		// This is a no-op
	}

	async commit(_message: string): Promise<string> {
		// In cloud mode, commits are handled via the API endpoint:
		// POST /api/projects/:id/github/commit
		// This is because commits require authenticated GitHub tokens
		// which are managed at the handler level, not the provider level.
		throw new Error('Use POST /api/projects/:id/github/commit for cloud mode commits');
	}

	async push(): Promise<void> {
		// In cloud mode, commit() pushes directly to GitHub
		// This is a no-op
	}

	async pull(): Promise<PullResult> {
		// TODO: Implement via GitHub API
		// 1. Get current tree from GitHub
		// 2. Compare with stored files
		// 3. Sync new/changed files to storage service
		console.warn('CloudStorageProvider.pull() not implemented - requires GitHub API');
		return { pulled: false, commits: 0, conflicts: [] };
	}

	async restore(relativePath: string): Promise<void> {
		// Normalize path: API uses leading slash, storage doesn't
		const storagePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		// Remove pending deletion to restore from committed version
		await this.client.deletePendingChange(this.projectId, this.userId, storagePath);
	}

	async getCurrentBranch(): Promise<string> {
		return this.defaultBranch;
	}

	async getRemoteUrl(): Promise<string | null> {
		if (this.repositoryOwner && this.repositoryName) {
			return `https://github.com/${this.repositoryOwner}/${this.repositoryName}`;
		}
		return null;
	}
}
