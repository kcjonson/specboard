/**
 * Entries of a commit's tree, looked up one path at a time, and the git blob sha a sync
 * records for a file it can't hold.
 *
 * A path is looked up with GitHub's contents API rather than a recursive tree listing,
 * which GitHub truncates for very large repositories: an incremental sync only ever
 * needs the paths a compare names, however big the repository is.
 */

import { createHash } from 'crypto';

const GITHUB_API_URL = 'https://api.github.com';

/** What a commit has at a path. */
export type TreeEntry =
	/** A file: its git blob sha, size in bytes, and content when it's small enough for GitHub to inline (≤ 1 MB). */
	| { kind: 'file'; sha: string; size: number; content: Buffer | null }
	/** A submodule (gitlink): no content in this repository. */
	| { kind: 'submodule'; sha: string }
	/** Anything else GitHub reports at the path (a directory). */
	| { kind: 'other' };

interface GitHubContents {
	type: 'file' | 'dir' | 'symlink' | 'submodule';
	sha: string;
	size: number;
	/** A symlink's target, which is what the archive holds for it too. */
	target?: string;
	content?: string;
	encoding?: 'base64' | 'none' | string;
}

/** Each path segment encoded, so names with #, ?, %, or spaces are looked up as themselves. */
function contentsPath(path: string): string {
	return path.split('/').map(encodeURIComponent).join('/');
}

/** What the commit `ref` has at `path`; null when it has nothing there. */
export async function fetchTreeEntry(owner: string, repo: string, ref: string, path: string, token: string): Promise<TreeEntry | null> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
	);
	if (response.status === 404) return null;
	if (!response.ok) {
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
			throw new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
		}
		throw new Error(`GitHub Contents API error: ${response.status}`);
	}

	const body = (await response.json()) as GitHubContents | GitHubContents[];
	if (Array.isArray(body)) return { kind: 'other' };
	if (body.type === 'submodule') return { kind: 'submodule', sha: body.sha };
	if (body.type === 'symlink' && typeof body.target === 'string') {
		return { kind: 'file', sha: body.sha, size: body.size, content: Buffer.from(body.target, 'utf-8') };
	}
	if (body.type !== 'file') return { kind: 'other' };
	const content = body.encoding === 'base64' && typeof body.content === 'string'
		? Buffer.from(body.content, 'base64')
		: null;
	return { kind: 'file', sha: body.sha, size: body.size, content };
}

/**
 * Hashes a file's bytes the way git names a blob: sha1 of "blob <size>\0" and the bytes.
 * Fed in pieces, so a file far over the size limit is hashed without being held.
 */
export class GitBlobHash {
	private readonly hash = createHash('sha1');

	constructor(size: number) {
		this.hash.update(`blob ${size}\0`);
	}

	update(bytes: Buffer): this {
		this.hash.update(bytes);
		return this;
	}

	digest(): string {
		return this.hash.digest('hex');
	}
}

/** The git blob sha of these bytes. */
export function gitBlobSha(bytes: Buffer): string {
	return new GitBlobHash(bytes.length).update(bytes).digest();
}
