/**
 * GitHub commit service using GraphQL createCommitOnBranch mutation.
 *
 * This provides atomic commits (all-or-nothing) with built-in conflict detection
 * via the expectedHeadOid parameter. Much simpler than the REST Git Data API
 * which requires ~30+ calls for a multi-file commit.
 */

export interface PendingChange {
	path: string;
	content: string | null; // null for deletions
	action: 'modified' | 'created' | 'deleted';
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
 * Get the current HEAD SHA for a branch.
 */
async function getBranchHeadSha(
	owner: string,
	repo: string,
	branch: string,
	token: string
): Promise<string> {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
	);

	if (!response.ok) {
		const error = await response.json().catch(() => ({ message: 'Unknown error' }));
		throw new Error(`Failed to get branch HEAD: ${error.message || response.statusText}`);
	}

	const data = await response.json() as { object: { sha: string } };
	return data.object.sha;
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
 * Create a commit on GitHub using the GraphQL createCommitOnBranch mutation.
 *
 * This is atomic - either all files are committed or none are.
 * Conflict detection is built-in via expectedHeadOid.
 */
export async function createGitHubCommit(params: {
	owner: string;
	repo: string;
	branch: string;
	token: string;
	message: string;
	changes: PendingChange[];
}): Promise<CommitResult> {
	const { owner, repo, branch, token, message, changes } = params;

	if (changes.length === 0) {
		return { success: false, error: 'No changes to commit' };
	}

	// 1. Get current HEAD SHA (for conflict detection)
	let headSha: string;
	try {
		headSha = await getBranchHeadSha(owner, repo, branch, token);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to get branch HEAD',
		};
	}

	// 2. Build file changes for mutation
	const additions = changes
		.filter((c) => c.action !== 'deleted' && c.content !== null)
		.map((c) => ({
			path: c.path,
			contents: Buffer.from(c.content!).toString('base64'),
		}));

	const deletions = changes
		.filter((c) => c.action === 'deleted')
		.map((c) => ({ path: c.path }));

	// 3. Execute GraphQL mutation
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
						expectedHeadOid: headSha,
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

	// 4. Handle errors (including conflicts)
	const firstError = result.errors?.[0];
	if (firstError) {
		const errorMessage = firstError.message;
		const isConflict =
			errorMessage.includes('expectedHeadOid') ||
			errorMessage.includes('out of date') ||
			errorMessage.includes('does not match');

		return {
			success: false,
			error: isConflict
				? 'Remote has new changes. Sync before committing.'
				: errorMessage,
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
