/**
 * The branch's file list at a commit, from GitHub's tree API: each path's blob sha and
 * size, and which paths are submodules (a gitlink, mode 160000, whose sha is the
 * submodule's commit, not a blob). Syncs use it to decide how to store a file before
 * downloading it, and to skip submodules, which have no content in this repository.
 */

const GITHUB_API_URL = 'https://api.github.com';

export interface TreeEntry {
	/** The blob's sha (40 hex); for a submodule, its commit. */
	sha: string;
	/** Bytes; 0 for a submodule. */
	size: number;
	submodule: boolean;
}

interface GitHubTreeResponse {
	truncated: boolean;
	tree: Array<{ path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }>;
}

/** Every file and submodule in the tree of `commitSha`, by path. Directories are left out. */
export async function fetchTree(owner: string, repo: string, commitSha: string, token: string): Promise<Map<string, TreeEntry>> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
	);
	if (!response.ok) {
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
			throw new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
		}
		throw new Error(`GitHub Tree API error: ${response.status}`);
	}

	const data = (await response.json()) as GitHubTreeResponse;
	// GitHub cuts the listing off for very large trees; a partial list could pass a file
	// off as missing, so refuse rather than sync from it.
	if (data.truncated) {
		throw new Error('Repository tree is too large to sync');
	}

	const entries = new Map<string, TreeEntry>();
	for (const item of data.tree) {
		if (item.type === 'tree') continue;
		entries.set(item.path, { sha: item.sha, size: item.size ?? 0, submodule: item.type === 'commit' });
	}
	return entries;
}
