/**
 * GitHub integration models
 *
 * Used by Settings > GitHub Connection and ProjectDialog for repository selection.
 * Follows the Model/SyncModel/SyncCollection patterns.
 */

import { fetchClient } from '@specboard/fetch';
import { Model } from './Model';
import { SyncModel } from './SyncModel';
import { SyncCollection } from './SyncCollection';
import { prop } from './prop';
import type { ModelMeta, ModelData } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Connection Model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GitHubConnectionModel - manages GitHub OAuth connection status
 *
 * Not a SyncModel because GitHub connection has custom endpoints:
 * - GET /api/github/connection - check status
 * - GET /api/auth/github - start OAuth (redirect)
 * - DELETE /api/auth/github - disconnect
 *
 * @example
 * ```tsx
 * const connection = useMemo(() => new GitHubConnectionModel(), []);
 * useModel(connection);
 *
 * if (connection.$meta.working) return <Loading />;
 * if (!connection.connected) return <ConnectButton onClick={connection.connect} />;
 * return <Connected username={connection.username} onDisconnect={connection.disconnect} />;
 * ```
 */
export class GitHubConnectionModel extends Model {
	@prop accessor connected!: boolean;
	@prop accessor username!: string | null;
	@prop accessor scopes!: string[];
	@prop accessor connectedAt!: string | null;

	declare readonly $meta: ModelMeta;

	constructor() {
		super({
			connected: false,
			username: null,
			scopes: [],
			connectedAt: null,
		});

		// Override $meta with working/error tracking
		Object.defineProperty(this, '$meta', {
			value: {
				working: false,
				error: null,
				lastFetched: null,
			},
			enumerable: false,
			writable: false,
		});

		// Auto-fetch on construction
		this.fetch();
	}

	private setMeta(updates: Partial<ModelMeta>): void {
		Object.assign(this.$meta, updates);
	}

	/**
	 * Fetch connection status from API
	 */
	async fetch(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			const data = await fetchClient.get<{
				connected: boolean;
				username?: string;
				scopes?: string[];
				connectedAt?: string;
			}>('/api/github/connection');

			this.set({
				connected: data.connected,
				username: data.username ?? null,
				scopes: data.scopes ?? [],
				connectedAt: data.connectedAt ?? null,
			} as unknown as Partial<ModelData<this>>);

			this.setMeta({ working: false, lastFetched: Date.now() });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	/**
	 * Start GitHub OAuth flow (redirects to GitHub)
	 */
	connect(): void {
		window.location.href = '/api/auth/github';
	}

	/**
	 * Disconnect GitHub account
	 */
	async disconnect(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			await fetchClient.delete('/api/auth/github');
			this.set({
				connected: false,
				username: null,
				scopes: [],
				connectedAt: null,
			} as unknown as Partial<ModelData<this>>);
			this.setMeta({ working: false });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Repos Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GitHubRepoModel - represents a GitHub repository
 */
export class GitHubRepoModel extends SyncModel {
	// No URL - these are read-only, fetched via collection
	static override url = '';

	@prop accessor id!: number;
	@prop accessor fullName!: string;
	@prop accessor name!: string;
	@prop accessor owner!: string;
	@prop accessor private!: boolean;
	@prop accessor defaultBranch!: string;
	@prop accessor url!: string;
}

/**
 * GitHubReposCollection - fetches user's GitHub repositories
 *
 * @example
 * ```tsx
 * const repos = useMemo(() => new GitHubReposCollection(), []);
 * useModel(repos);
 *
 * if (repos.$meta.working) return <Loading />;
 * return repos.map(repo => <RepoOption repo={repo} />);
 * ```
 */
export class GitHubReposCollection extends SyncCollection<GitHubRepoModel> {
	static url = '/api/github/repos';
	static Model = GitHubRepoModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Branches Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GitHubBranchModel - represents a GitHub branch
 */
export class GitHubBranchModel extends SyncModel {
	// No URL - these are read-only, fetched via collection
	static override url = '';

	@prop accessor name!: string;
	@prop accessor protected!: boolean;
}

/**
 * GitHubBranchesCollection - fetches branches for a specific repository
 *
 * @example
 * ```tsx
 * const branches = useMemo(
 *   () => new GitHubBranchesCollection({ owner: 'user', repo: 'my-repo' }),
 *   [owner, repo]
 * );
 * useModel(branches);
 *
 * if (branches.$meta.working) return <Loading />;
 * return branches.map(branch => <BranchOption branch={branch} />);
 * ```
 */
export class GitHubBranchesCollection extends SyncCollection<GitHubBranchModel> {
	static url = '/api/github/repos/:owner/:repo/branches';
	static Model = GitHubBranchModel;

	/** Repository owner (from constructor) */
	owner!: string;

	/** Repository name (from constructor) */
	repo!: string;
}
