/**
 * GitHub integration models
 *
 * Used by Settings > GitHub Connection and ProjectDialog for repository selection.
 * Follows the Model/SyncModel/SyncCollection patterns.
 */

import { fetchClient } from '@specboard/fetch';
import { SyncModel } from './SyncModel';
import { SyncCollection } from './SyncCollection';
import { prop } from './prop';
import type { ModelData } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Connection Model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GitHubConnectionModel - manages GitHub OAuth connection status
 *
 * Singleton SyncModel (no :id in URL). Custom methods for OAuth flow:
 * - connect() - redirects to GitHub OAuth
 * - disconnect() - DELETEs via a separate auth endpoint
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
export class GitHubConnectionModel extends SyncModel {
	static override url = '/api/github/connection';

	@prop accessor connected!: boolean;
	@prop accessor username!: string | null;
	@prop accessor scopes!: string[];
	@prop accessor connectedAt!: string | null;

	constructor() {
		super({
			connected: false,
			username: null,
			scopes: [],
			connectedAt: null,
		});

		this.fetch().catch(() => {});
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
