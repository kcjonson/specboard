/**
 * GitStatusModel - Observable state for git repository status
 *
 * Tracks branch info, changed files, and provides commit/pull/restore operations.
 */

import { Model } from './Model';
import { prop } from './prop';
import { fetchClient } from '@doc-platform/fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangedFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface CommitError {
	stage: 'commit' | 'push' | 'merge';
	message: string;
}

interface GitStatusResponse {
	branch: string;
	ahead: number;
	behind: number;
	changedFiles: ChangedFile[];
}

interface CommitResponse {
	success: boolean;
	sha?: string;
	message?: string;
	filesCommitted?: number;
	error?: CommitError;
}

interface RestoreResponse {
	success: boolean;
	path: string;
}

interface PullResponse {
	success: boolean;
	commits?: number;
	error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

export class GitStatusModel extends Model {
	/** Project ID for API calls */
	@prop accessor projectId!: string;

	/** Current branch name */
	@prop accessor branch!: string;

	/** Commits ahead of remote */
	@prop accessor ahead!: number;

	/** Commits behind remote */
	@prop accessor behind!: number;

	/** Files with uncommitted changes */
	@prop accessor changedFiles!: ChangedFile[];

	/** Loading status */
	@prop accessor loading!: boolean;

	/** Whether a commit is in progress */
	@prop accessor committing!: boolean;

	/** Whether a pull is in progress */
	@prop accessor pulling!: boolean;

	/** Last commit error */
	@prop accessor commitError!: CommitError | null;

	/** Last pull error */
	@prop accessor pullError!: string | null;

	/** General error message */
	@prop accessor error!: string | null;

	constructor() {
		super({
			projectId: '',
			branch: '',
			ahead: 0,
			behind: 0,
			changedFiles: [],
			loading: false,
			committing: false,
			pulling: false,
			commitError: null,
			pullError: null,
			error: null,
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Computed getters
	// ─────────────────────────────────────────────────────────────────────────

	/** Check if a file has uncommitted changes */
	hasChanges(path: string): boolean {
		return this.changedFiles.some((f) => f.path === path);
	}

	/** Get change status for a file */
	getChangeStatus(path: string): ChangedFile['status'] | null {
		const file = this.changedFiles.find((f) => f.path === path);
		return file?.status ?? null;
	}

	/** Check if a file is deleted */
	isDeleted(path: string): boolean {
		return this.getChangeStatus(path) === 'deleted';
	}

	/** Get total count of changed files */
	get changedCount(): number {
		return this.changedFiles.length;
	}

	/** Check if there are any changes */
	get hasAnyChanges(): boolean {
		return this.changedFiles.length > 0;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Actions
	// ─────────────────────────────────────────────────────────────────────────

	/** Fetch git status from server */
	async refresh(): Promise<void> {
		if (!this.projectId) return;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetchClient.get<GitStatusResponse>(
				`/api/projects/${this.projectId}/git/status`
			);

			this.branch = response.branch;
			this.ahead = response.ahead;
			this.behind = response.behind;
			this.changedFiles = response.changedFiles;
			this.loading = false;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to get git status';
			this.loading = false;
		}
	}

	/** Commit all changes */
	async commit(commitMessage?: string): Promise<{ sha: string } | null> {
		if (!this.projectId) return null;

		this.committing = true;
		this.commitError = null;

		try {
			const response = await fetchClient.post<CommitResponse>(
				`/api/projects/${this.projectId}/git/commit`,
				commitMessage ? { message: commitMessage } : {}
			);

			if (!response.success && response.error) {
				this.commitError = response.error;
				this.committing = false;
				return null;
			}

			// Refresh status after successful commit
			await this.refresh();

			this.committing = false;
			return response.sha ? { sha: response.sha } : null;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Commit failed';
			this.commitError = { stage: 'commit', message: errorMessage };
			this.committing = false;
			return null;
		}
	}

	/** Restore a deleted file from git */
	async restore(path: string): Promise<boolean> {
		if (!this.projectId) return false;

		try {
			const response = await fetchClient.post<RestoreResponse>(
				`/api/projects/${this.projectId}/git/restore`,
				{ path }
			);

			if (response.success) {
				// Refresh status after restore
				await this.refresh();
				return true;
			}
			return false;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Restore failed';
			return false;
		}
	}

	/** Pull latest changes from remote */
	async pull(): Promise<{ success: boolean; commits?: number }> {
		if (!this.projectId) return { success: false };

		this.pulling = true;
		this.pullError = null;

		try {
			const response = await fetchClient.post<PullResponse>(
				`/api/projects/${this.projectId}/git/pull`,
				{}
			);

			if (!response.success) {
				this.pullError = response.error || 'Pull failed';
				this.pulling = false;
				return { success: false };
			}

			// Refresh status after successful pull
			await this.refresh();

			this.pulling = false;
			return { success: true, commits: response.commits };
		} catch (err) {
			this.pullError = err instanceof Error ? err.message : 'Pull failed';
			this.pulling = false;
			return { success: false };
		}
	}

	/** Clear any errors */
	clearErrors(): void {
		this.error = null;
		this.commitError = null;
		this.pullError = null;
	}
}
