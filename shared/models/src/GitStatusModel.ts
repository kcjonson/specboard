/**
 * GitStatusModel - Observable state for git repository status
 *
 * Tracks branch info, changed files, and provides commit/pull/restore operations.
 */

import { Model } from './Model';
import { prop } from './prop';
import { fetchClient, FetchError } from '@specboard/fetch';
import { writeFailure } from './write-failure';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangedFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	isUntracked: boolean;
}

export interface CommitError {
	stage: 'commit' | 'push' | 'merge';
	message: string;
	/** The branch moved since the last pull: the way forward is to pull, not to retry. */
	conflictDetected?: boolean;
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
	conflictDetected?: boolean;
	/** The commit landed but something after it didn't; says what to do (pull). */
	warning?: string;
}

interface RestoreResponse {
	success: boolean;
	path: string;
}

interface PullResponse {
	success: boolean;
	commits?: number;
	error?: string;
	/** 'pending' when a cloud pull started a sync that finishes in the background. */
	status?: string;
}

interface SyncStatusResponse {
	status: string | null;
	error: string | null;
}

/** How often, and for how long, a pull waits on a background sync. */
const SYNC_POLL_MS = 1000;
const SYNC_POLL_LIMIT = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

export class GitStatusModel extends Model {
	/** Project ref (owner/project) for API calls */
	@prop accessor projectRef!: string;

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

	/** What to do after a commit that landed without everything following it */
	@prop accessor commitWarning!: string | null;

	/** Last pull error */
	@prop accessor pullError!: string | null;

	/** General error message */
	@prop accessor error!: string | null;

	constructor() {
		super({
			projectRef: '',
			branch: '',
			ahead: 0,
			behind: 0,
			changedFiles: [],
			loading: false,
			committing: false,
			pulling: false,
			commitError: null,
			commitWarning: null,
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

	/** Check if a file is untracked (never been committed) */
	isUntracked(path: string): boolean {
		const file = this.changedFiles.find((f) => f.path === path);
		return file?.isUntracked ?? false;
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
		if (!this.projectRef) return;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetchClient.get<GitStatusResponse>(
				`/api/projects/${this.projectRef}/git/status`
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
		if (!this.projectRef) return null;

		this.committing = true;
		this.commitError = null;
		this.commitWarning = null;

		try {
			const response = await fetchClient.post<CommitResponse>(
				`/api/projects/${this.projectRef}/git/commit`,
				commitMessage ? { message: commitMessage } : {}
			);

			if (!response.success && response.error) {
				this.commitError = response.error;
				this.committing = false;
				return null;
			}

			this.commitWarning = response.warning ?? null;

			// Refresh status after successful commit
			await this.refresh();

			this.committing = false;
			return response.sha ? { sha: response.sha } : null;
		} catch (err) {
			// A refused commit (409: the branch moved, pull first) carries its CommitError
			// in the body; anything else is the server's message or a fallback.
			const data = err instanceof FetchError ? (err.data as Partial<CommitResponse> | undefined) : undefined;
			const sent = data?.error;
			this.commitError = typeof sent === 'object' && sent !== null
				? { ...sent, conflictDetected: data?.conflictDetected === true }
				: { stage: 'commit', message: writeFailure(err, 'Commit failed', this.projectRef) };
			this.committing = false;
			return null;
		}
	}

	/** Restore a deleted file from git */
	async restore(path: string): Promise<boolean> {
		if (!this.projectRef) return false;

		try {
			const response = await fetchClient.post<RestoreResponse>(
				`/api/projects/${this.projectRef}/git/restore`,
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
		if (!this.projectRef) return { success: false };

		this.pulling = true;
		this.pullError = null;

		try {
			const response = await fetchClient.post<PullResponse>(
				`/api/projects/${this.projectRef}/git/pull`,
				{}
			);

			if (!response.success) {
				this.pullError = response.error || 'Pull failed';
				this.pulling = false;
				return { success: false };
			}

			// A cloud pull only starts the sync; the files aren't there until it's done.
			if (response.status === 'pending') {
				const syncError = await this.waitForSync();
				if (syncError) {
					this.pullError = syncError;
					this.pulling = false;
					return { success: false };
				}
			}

			// Refresh status after successful pull
			await this.refresh();

			this.pulling = false;
			return { success: true, commits: response.commits };
		} catch (err) {
			this.pullError = writeFailure(err, 'Pull failed', this.projectRef);
			this.pulling = false;
			return { success: false };
		}
	}

	/** Poll the project's sync until it finishes; its error if it failed, else null. */
	private async waitForSync(): Promise<string | null> {
		for (let poll = 0; poll < SYNC_POLL_LIMIT; poll++) {
			const sync = await fetchClient.get<SyncStatusResponse>(`/api/projects/${this.projectRef}/sync/status`);
			if (sync.status === 'failed') return sync.error || 'Pull failed';
			if (sync.status !== 'pending' && sync.status !== 'syncing') return null;
			await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
		}
		return 'The pull is taking longer than expected. Check back in a few minutes.';
	}

	/** Clear any errors */
	clearErrors(): void {
		this.error = null;
		this.commitError = null;
		this.commitWarning = null;
		this.pullError = null;
	}
}
