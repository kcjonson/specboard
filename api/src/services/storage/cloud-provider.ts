/**
 * Cloud storage provider using internal storage service + GitHub API.
 * Used for web/cloud deployments where we can't access the local filesystem.
 */

import { StorageClient, getStorageClient } from './storage-client.ts';
import type {
	StorageProvider,
	FileEntry,
	OpenedDocument,
	ListDirectoryOptions,
	GitStatus,
	Commit,
	PullResult,
} from './types.ts';

/**
 * Thrown for a file on the branch that the editor can't hold (binary, or over the sync's
 * size limit): there's no content here to read, and a draft over it isn't allowed.
 */
export const FILE_UNAVAILABLE = 'FILE_UNAVAILABLE';

/** API paths have a leading slash; storage paths don't. */
function toStoragePath(relativePath: string): string {
	return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
}

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
		const [committed, pending] = await Promise.all([
			this.client.listFiles(this.projectId),
			this.client.listPendingChanges(this.projectId, this.userId),
		]);

		// Overlay pending creations so new and renamed files are visible before
		// commit. Deleted paths stay listed — the tree marks them from git status.
		const byPath = new Map(committed.map((f) => [f.path, f]));
		for (const change of pending) {
			if (change.action === 'deleted' || byPath.has(change.path)) continue;
			byPath.set(change.path, {
				path: change.path,
				contentHash: '',
				sizeBytes: 0,
				syncedAt: change.updatedAt,
			});
		}
		const files = Array.from(byPath.values());

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
					// A pending creation has no committed version to name.
					...(file.contentHash ? { contentHash: file.contentHash } : {}),
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
		const file = await this.readWithOrigin(toStoragePath(relativePath));
		if (!file) {
			throw new Error(`File not found: ${relativePath}`);
		}
		return file.content;
	}

	async readDocument(relativePath: string): Promise<OpenedDocument> {
		const file = await this.readWithOrigin(toStoragePath(relativePath));
		if (!file) {
			throw new Error(`File not found: ${relativePath}`);
		}
		return { content: file.content, baseContentHash: file.base };
	}

	/**
	 * The caller's current content for a path; the committed path it carries the
	 * identity of (the path itself when committed, where a rename started when the path
	 * is the new side of one, or null for a file that was never committed); and the
	 * committed version it was made against (the draft's base, or the committed file's
	 * own hash when there's no draft).
	 */
	private async readWithOrigin(
		storagePath: string
	): Promise<{ content: string; origin: string | null; base: string | null } | null> {
		const pending = await this.client.getPendingChange(this.projectId, this.userId, storagePath);
		if (pending && pending.action !== 'deleted' && pending.content !== null) {
			const origin = pending.renamedFrom ?? (pending.action === 'modified' ? storagePath : null);
			return { content: pending.content, origin, base: pending.baseContentHash };
		}

		const file = await this.client.getFile(this.projectId, storagePath);
		if (!file) return null;
		if (file.content === null) throw new Error(FILE_UNAVAILABLE);
		return { content: file.content, origin: storagePath, base: file.contentHash };
	}

	async writeFile(relativePath: string, content: string, baseContentHash?: string | null): Promise<void> {
		await this.putContent(toStoragePath(relativePath), content, null, baseContentHash);
	}

	/**
	 * `renamedFrom` null keeps whatever origin the pending change already records;
	 * `baseContentHash` undefined leaves the base to what's committed when the draft
	 * row is first written.
	 */
	private async putContent(
		storagePath: string,
		content: string,
		renamedFrom: string | null,
		baseContentHash: string | null | undefined
	): Promise<void> {
		const committed = await this.client.getFile(this.projectId, storagePath);
		// A draft over a file the editor can't hold would replace it, unseen, on commit.
		if (committed?.content === null) throw new Error(FILE_UNAVAILABLE);

		// Writing the committed content back clears the pending change instead of
		// journaling a no-op that would keep the file dirty until the next commit.
		if (committed && committed.content === content) {
			await this.client.deletePendingChange(this.projectId, this.userId, storagePath);
			return;
		}

		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storagePath,
			content,
			committed ? 'modified' : 'created',
			renamedFrom,
			baseContentHash
		);
	}

	async deleteFile(relativePath: string, baseContentHash?: string | null): Promise<void> {
		const storagePath = toStoragePath(relativePath);

		// A file that was never committed only exists as a pending creation, so
		// deleting it just discards that — a 'deleted' journal entry would name a
		// path no commit contains.
		const committed = await this.client.getFile(this.projectId, storagePath);
		if (!committed) {
			await this.client.deletePendingChange(this.projectId, this.userId, storagePath);
			return;
		}

		await this.client.putPendingChange(
			this.projectId,
			this.userId,
			storagePath,
			null,
			'deleted',
			null,
			baseContentHash
		);
	}

	async createDirectory(_relativePath: string): Promise<void> {
		// Directories are implicit in S3/storage - no-op
		// Files create their parent directories automatically
	}

	async rename(oldPath: string, newPath: string, sourceBaseContentHash?: string | null): Promise<void> {
		// putContent/deleteFile carry the journal semantics: renaming back to a committed
		// path clears its pending change, and renaming away from a never-committed path
		// discards the creation rather than recording a phantom deletion. The new side
		// records where the file was committed, which is how a commit tells this rename
		// from an unrelated delete and create and moves the file's spec links with it.
		// A draft over a file that has since become one the editor can't hold would carry
		// stale text to the new name, and the commit would delete the real file.
		if ((await this.client.getFile(this.projectId, toStoragePath(oldPath)))?.content === null) {
			throw new Error(FILE_UNAVAILABLE);
		}
		const file = await this.readWithOrigin(toStoragePath(oldPath));
		if (!file) {
			throw new Error(`File not found: ${oldPath}`);
		}
		const to = toStoragePath(newPath);
		// Moving back onto its own committed path isn't a rename of anything.
		// The new path starts from what's committed there (normally nothing). The old
		// path's deletion carries what the caller last saw of the file, so a rename of a
		// file someone has changed since conflicts there ("renamed it to ..."); a draft
		// already at the old path keeps its own base.
		await this.putContent(to, file.content, file.origin === to ? null : file.origin, undefined);
		await this.deleteFile(oldPath, sourceBaseContentHash);
	}

	async exists(relativePath: string): Promise<boolean> {
		const storagePath = toStoragePath(relativePath);

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

		// The deletion a rename journals at the old path, keyed to the draft where the file went.
		const renamedTo = new Map(
			pending.flatMap((change) => (change.renamedFrom && change.action !== 'deleted' ? [[change.renamedFrom, change] as const] : []))
		);

		for (const change of pending) {
			// A draft started where nothing was committed is one the caller created, even
			// once someone has committed a file at the same path (a later save then calls
			// it 'modified').
			const created = change.action === 'created' || (change.action === 'modified' && change.baseContentHash === null);
			const status = change.action === 'deleted' ? 'deleted' : created ? 'added' : 'modified';

			// Return paths with leading slash to match API convention
			const movedTo = change.action === 'deleted' ? renamedTo.get(change.path) : undefined;
			unstaged.push({
				path: '/' + change.path,
				status,
				conflict: change.conflict,
				...(change.committedUnavailable && change.action !== 'deleted' ? { overUnavailable: true } : {}),
				...(movedTo
					? {
						renamedTo: '/' + movedTo.path,
						// A rename that carried what's committed now (nothing edited since)
						// keeps the other person's version under the new name.
						renameKeepsCommitted: movedTo.contentHash !== null && movedTo.contentHash === change.committedHash,
					}
					: {}),
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
		const storagePath = toStoragePath(relativePath);

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
