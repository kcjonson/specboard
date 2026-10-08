/**
 * GitHub commit service using GraphQL createCommitOnBranch mutation.
 *
 * This provides atomic commits (all-or-nothing) with built-in conflict detection
 * via the expectedHeadOid parameter. Much simpler than the REST Git Data API
 * which requires ~30+ calls for a multi-file commit.
 */

import type { SpecPathChanges } from '@specboard/db';

export interface PendingChange {
	path: string;
	content: string | null; // null for deletions
	action: 'modified' | 'created' | 'deleted';
}

/** A change in a commit, with the committed path it was renamed from, if any. */
export interface CommittedChange {
	path: string;
	action: 'modified' | 'created' | 'deleted';
	renamedFrom: string | null;
}

export interface CommitResult {
	success: boolean;
	sha?: string;
	url?: string;
	filesCommitted?: number;
	error?: string;
	conflictDetected?: boolean;
}

interface GitHubGraphQLError {
	message: string;
	type?: string;
	path?: string[];
}

interface CreateCommitResponse {
	data?: {
		createCommitOnBranch?: {
			commit?: {
				oid: string;
				url: string;
			};
		};
	};
	errors?: GitHubGraphQLError[];
}

/**
 * Generate a commit message from the list of changes.
 */
export function generateCommitMessage(changes: PendingChange[]): string {
	const created = changes.filter((c) => c.action === 'created');
	const modified = changes.filter((c) => c.action === 'modified');
	const deleted = changes.filter((c) => c.action === 'deleted');

	const parts: string[] = [];

	if (created.length === 1 && created[0]) {
		parts.push(`Add ${created[0].path}`);
	} else if (created.length > 1) {
		parts.push(`Add ${created.length} files`);
	}

	if (modified.length === 1 && modified[0]) {
		parts.push(`Update ${modified[0].path}`);
	} else if (modified.length > 1) {
		parts.push(`Update ${modified.length} files`);
	}

	if (deleted.length === 1 && deleted[0]) {
		parts.push(`Delete ${deleted[0].path}`);
	} else if (deleted.length > 1) {
		parts.push(`Delete ${deleted.length} files`);
	}

	if (parts.length === 0) {
		return 'Update files';
	}

	return parts.join(', ');
}

/**
 * What a commit does to the files spec links point at, as paths before the commit.
 * A path is vacated when the commit deletes it or a renamed file lands on it (the
 * pending change there is `modified` with a `renamedFrom`). A change renamed from a
 * vacated path takes that path's links; a vacated path nothing took drops its links.
 * A rename whose old path is still there (restored before the commit) is a copy, and
 * the links stay on the old path. Storage paths have no leading slash; spec paths do.
 */
export function committedSpecPathChanges(changes: CommittedChange[]): SpecPathChanges {
	const vacated = new Set(
		changes
			.filter((c) => c.action === 'deleted' || (c.action === 'modified' && c.renamedFrom))
			.map((c) => c.path)
	);
	const renamed: SpecPathChanges['renamed'] = [];
	for (const change of changes) {
		const from = change.renamedFrom;
		if (change.action === 'deleted' || !from || !vacated.has(from)) continue;
		// Claimed once: a second file renamed from the same path is a copy.
		vacated.delete(from);
		renamed.push({ from: `/${from}`, to: `/${change.path}` });
	}
	return { renamed, deleted: [...vacated].map((path) => `/${path}`) };
}

/** What the editor shows when the branch moved past the caller's last sync. */
export const STALE_BRANCH_MESSAGE = 'The branch has commits you haven\'t pulled yet. Pull, then commit again.';

/**
 * Create a commit on GitHub using the GraphQL createCommitOnBranch mutation.
 *
 * This is atomic - either all files are committed or none are. `expectedHeadOid` is
 * the commit the caller's drafts were made against (the project's last sync), so
 * GitHub refuses the commit when anything landed on the branch since, instead of
 * writing the drafts over changes nobody here has seen.
 */
export async function createGitHubCommit(params: {
	owner: string;
	repo: string;
	branch: string;
	token: string;
	message: string;
	changes: PendingChange[];
	expectedHeadOid: string;
}): Promise<CommitResult> {
	const { owner, repo, branch, token, message, changes, expectedHeadOid } = params;

	if (changes.length === 0) {
		return { success: false, error: 'No changes to commit' };
	}

	// 1. Build file changes for mutation
	const additions = changes
		.filter((c) => c.action !== 'deleted' && c.content !== null)
		.map((c) => ({
			path: c.path,
			contents: Buffer.from(c.content!).toString('base64'),
		}));

	const deletions = changes
		.filter((c) => c.action === 'deleted')
		.map((c) => ({ path: c.path }));

	// 2. Execute GraphQL mutation
	let response: Response;
	try {
		response = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query: `
					mutation CreateCommit($input: CreateCommitOnBranchInput!) {
						createCommitOnBranch(input: $input) {
							commit {
								oid
								url
							}
						}
					}
				`,
				variables: {
					input: {
						branch: {
							repositoryNameWithOwner: `${owner}/${repo}`,
							branchName: branch,
						},
						message: { headline: message },
						expectedHeadOid,
						fileChanges: {
							additions: additions.length > 0 ? additions : undefined,
							deletions: deletions.length > 0 ? deletions : undefined,
						},
					},
				},
			}),
		});
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? `Network error: ${err.message}` : 'Network error contacting GitHub',
		};
	}

	if (!response.ok) {
		return {
			success: false,
			error: `GitHub API error: ${response.status} ${response.statusText}`,
		};
	}

	let result: CreateCommitResponse;
	try {
		result = (await response.json()) as CreateCommitResponse;
	} catch {
		return {
			success: false,
			error: 'Failed to parse GitHub API response',
		};
	}

	// 3. Handle errors. GitHub answers a moved branch with STALE_DATA ("Expected branch
	// to point to ... but it did not").
	const firstError = result.errors?.[0];
	if (firstError) {
		const isConflict =
			firstError.type === 'STALE_DATA' || firstError.message.startsWith('Expected branch to point to');

		return {
			success: false,
			error: isConflict ? STALE_BRANCH_MESSAGE : firstError.message,
			conflictDetected: isConflict,
		};
	}

	// Validate response structure explicitly
	const data = result.data;
	if (!data || !data.createCommitOnBranch || !data.createCommitOnBranch.commit) {
		return {
			success: false,
			error: 'Unexpected response from GitHub API',
		};
	}

	const commit = data.createCommitOnBranch.commit;
	return {
		success: true,
		sha: commit.oid,
		url: commit.url,
		filesCommitted: changes.length,
	};
}
