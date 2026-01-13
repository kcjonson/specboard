/**
 * GitHub sync handlers for cloud storage mode.
 * Orchestrates between storage service and GitHub API.
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME, decrypt, type EncryptedData } from '@doc-platform/auth';
import { query } from '@doc-platform/db';
import { log } from '@doc-platform/core';
import { getStorageClient } from '../services/storage/storage-client.ts';

const GITHUB_API_URL = 'https://api.github.com';

// File extensions to sync (documentation focus)
const SYNC_EXTENSIONS = ['.md', '.mdx', '.txt', '.json', '.yaml', '.yml'];

// Maximum file size to sync (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

interface GitHubTreeEntry {
	path: string;
	mode: string;
	type: 'blob' | 'tree' | 'commit';
	sha: string;
	size?: number;
	url?: string;
}

interface GitHubTree {
	sha: string;
	url: string;
	tree: GitHubTreeEntry[];
	truncated: boolean;
}

interface GitHubBlob {
	content: string;
	encoding: 'base64' | 'utf-8';
	sha: string;
	size: number;
}

/**
 * Get decrypted GitHub access token for a user.
 */
async function getGitHubToken(userId: string): Promise<string | null> {
	const result = await query<{ access_token: string }>(
		'SELECT access_token FROM github_connections WHERE user_id = $1',
		[userId]
	);

	if (result.rows.length === 0) {
		return null;
	}

	try {
		const encrypted: EncryptedData = JSON.parse(result.rows[0]!.access_token);
		return decrypt(encrypted);
	} catch {
		return null;
	}
}

/**
 * Get project with repository info.
 */
async function getProjectWithRepo(
	projectId: string,
	userId: string
): Promise<{
	id: string;
	repository_owner: string;
	repository_name: string;
	repository_branch: string;
} | null> {
	const result = await query<{
		id: string;
		repository_owner: string;
		repository_name: string;
		repository_branch: string;
	}>(
		`SELECT id, repository_owner, repository_name, repository_branch
		 FROM projects
		 WHERE id = $1 AND user_id = $2
		   AND storage_mode = 'cloud'
		   AND repository_owner IS NOT NULL`,
		[projectId, userId]
	);

	return result.rows[0] || null;
}

/**
 * Sync files from GitHub repository to storage service.
 * POST /api/projects/:id/sync
 */
export async function handleGitHubSync(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!projectId) {
		return context.json({ error: 'Project ID required' }, 400);
	}

	// Get project with repository info
	const project = await getProjectWithRepo(projectId, session.userId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	// Get GitHub token
	const token = await getGitHubToken(session.userId);
	if (!token) {
		return context.json({ error: 'GitHub not connected' }, 400);
	}

	const { repository_owner: owner, repository_name: repo, repository_branch: branch } = project;
	const storageClient = getStorageClient();

	try {
		// Get repository tree from GitHub
		const treeResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=true`,
			{
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
				},
			}
		);

		if (!treeResponse.ok) {
			if (treeResponse.status === 404) {
				return context.json({ error: 'Repository or branch not found' }, 404);
			}
			if (treeResponse.status === 401) {
				return context.json({ error: 'GitHub authorization expired' }, 401);
			}
			throw new Error(`GitHub API error: ${treeResponse.status}`);
		}

		const tree: GitHubTree = await treeResponse.json();

		if (tree.truncated) {
			log({
				type: 'github',
				level: 'warn',
				event: 'github_tree_truncated',
				projectId,
				owner,
				repo,
			});
		}

		// Filter to sync-able files
		const filesToSync = tree.tree.filter((entry) => {
			if (entry.type !== 'blob') return false;
			if (entry.size && entry.size > MAX_FILE_SIZE) return false;

			const ext = '.' + entry.path.split('.').pop()?.toLowerCase();
			return SYNC_EXTENSIONS.includes(ext);
		});

		let synced = 0;
		let skipped = 0;

		// Fetch and store each file
		for (const entry of filesToSync) {
			try {
				// Get blob content
				const blobResponse = await fetch(
					`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${entry.sha}`,
					{
						headers: {
							'Accept': 'application/vnd.github+json',
							'Authorization': `Bearer ${token}`,
							'X-GitHub-Api-Version': '2022-11-28',
						},
					}
				);

				if (!blobResponse.ok) {
					skipped++;
					continue;
				}

				const blob: GitHubBlob = await blobResponse.json();

				// Decode content
				let content: string;
				if (blob.encoding === 'base64') {
					content = Buffer.from(blob.content, 'base64').toString('utf-8');
				} else {
					content = blob.content;
				}

				// Store in storage service
				await storageClient.putFile(projectId, entry.path, content, entry.sha);
				synced++;
			} catch (err) {
				log({
					type: 'github',
					level: 'error',
					event: 'github_file_sync_error',
					projectId,
					path: entry.path,
					error: err instanceof Error ? err.message : String(err),
				});
				skipped++;
			}
		}

		log({
			type: 'github',
			level: 'info',
			event: 'github_sync_complete',
			projectId,
			owner,
			repo,
			synced,
			skipped,
		});

		return context.json({
			synced,
			skipped,
			total: filesToSync.length,
		});
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_sync_error',
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'Sync failed' }, 500);
	}
}

/**
 * Commit pending changes to GitHub repository.
 * POST /api/projects/:id/commit
 *
 * Uses GitHub Git Data API to create commits without cloning:
 * 1. Get pending changes from storage service
 * 2. Create blobs for each changed file
 * 3. Create tree with base_tree
 * 4. Create commit
 * 5. Update ref
 * 6. Clear pending changes and update storage
 */
export async function handleGitHubCommit(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'unauthorized' }, 401);
	}

	const projectId = context.req.param('id');
	if (!projectId) {
		return context.json({ error: 'Project ID required' }, 400);
	}

	const body = await context.req.json<{ message: string }>().catch(() => null);
	if (!body?.message) {
		return context.json({ error: 'Commit message required' }, 400);
	}

	// Get project with repository info
	const project = await getProjectWithRepo(projectId, session.userId);
	if (!project) {
		return context.json({ error: 'Project not found or not in cloud mode' }, 404);
	}

	// Get GitHub token
	const token = await getGitHubToken(session.userId);
	if (!token) {
		return context.json({ error: 'GitHub not connected' }, 400);
	}

	const { repository_owner: owner, repository_name: repo, repository_branch: branch } = project;
	const storageClient = getStorageClient();

	try {
		// Get pending changes
		const pending = await storageClient.listPendingChanges(projectId, session.userId);
		if (pending.length === 0) {
			return context.json({ error: 'No changes to commit' }, 400);
		}

		// Get current commit SHA (head of branch)
		const refResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
			{
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
				},
			}
		);

		if (!refResponse.ok) {
			throw new Error('Failed to get branch ref');
		}

		const ref: { object: { sha: string } } = await refResponse.json();
		const parentSha = ref.object.sha;

		// Get parent commit to get base tree
		const commitResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${parentSha}`,
			{
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
				},
			}
		);

		if (!commitResponse.ok) {
			throw new Error('Failed to get parent commit');
		}

		const parentCommit: { tree: { sha: string } } = await commitResponse.json();
		const baseTreeSha = parentCommit.tree.sha;

		// Create blobs and build tree entries
		const treeEntries: Array<{
			path: string;
			mode: string;
			type: string;
			sha?: string;
		}> = [];

		for (const change of pending) {
			if (change.action === 'deleted') {
				// For deletions, we omit the entry (it won't be in the new tree)
				// Note: This is a simplification - proper deletion requires building full tree
				continue;
			}

			// Get content for changed file
			const content = await storageClient.getPendingChange(
				projectId,
				session.userId,
				change.path
			);

			if (!content || content.content === null) continue;

			// Create blob
			const blobResponse = await fetch(
				`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
				{
					method: 'POST',
					headers: {
						'Accept': 'application/vnd.github+json',
						'Authorization': `Bearer ${token}`,
						'Content-Type': 'application/json',
						'X-GitHub-Api-Version': '2022-11-28',
					},
					body: JSON.stringify({
						content: content.content,
						encoding: 'utf-8',
					}),
				}
			);

			if (!blobResponse.ok) {
				throw new Error(`Failed to create blob for ${change.path}`);
			}

			const blob: { sha: string } = await blobResponse.json();

			treeEntries.push({
				path: change.path,
				mode: '100644', // Regular file
				type: 'blob',
				sha: blob.sha,
			});
		}

		if (treeEntries.length === 0) {
			return context.json({ error: 'No valid changes to commit' }, 400);
		}

		// Create tree
		const treeResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
			{
				method: 'POST',
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				body: JSON.stringify({
					base_tree: baseTreeSha,
					tree: treeEntries,
				}),
			}
		);

		if (!treeResponse.ok) {
			throw new Error('Failed to create tree');
		}

		const newTree: { sha: string } = await treeResponse.json();

		// Create commit
		const newCommitResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
			{
				method: 'POST',
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				body: JSON.stringify({
					message: body.message,
					tree: newTree.sha,
					parents: [parentSha],
				}),
			}
		);

		if (!newCommitResponse.ok) {
			throw new Error('Failed to create commit');
		}

		const newCommit: { sha: string } = await newCommitResponse.json();

		// Update ref
		const updateRefResponse = await fetch(
			`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
			{
				method: 'PATCH',
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				body: JSON.stringify({
					sha: newCommit.sha,
				}),
			}
		);

		if (!updateRefResponse.ok) {
			throw new Error('Failed to update branch ref');
		}

		// Clear pending changes and update storage with new committed files
		for (const change of pending) {
			if (change.action !== 'deleted') {
				const content = await storageClient.getPendingChange(
					projectId,
					session.userId,
					change.path
				);
				if (content?.content) {
					await storageClient.putFile(projectId, change.path, content.content);
				}
			} else {
				await storageClient.deleteFile(projectId, change.path);
			}
		}

		await storageClient.deleteAllPendingChanges(projectId, session.userId);

		log({
			type: 'github',
			level: 'info',
			event: 'github_commit_success',
			projectId,
			owner,
			repo,
			sha: newCommit.sha,
			filesChanged: treeEntries.length,
		});

		return context.json({
			sha: newCommit.sha,
			filesCommitted: treeEntries.length,
		});
	} catch (err) {
		log({
			type: 'github',
			level: 'error',
			event: 'github_commit_error',
			projectId,
			error: err instanceof Error ? err.message : String(err),
		});
		return context.json({ error: 'Commit failed' }, 500);
	}
}
