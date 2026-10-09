/**
 * Entries of a commit's tree, looked up one path at a time, and the git blob sha a sync
 * records for a file it can't hold.
 *
 * A path is looked up with GitHub's contents API rather than a recursive tree listing,
 * which GitHub truncates for very large repositories: an incremental sync only ever
 * needs the paths a compare names, however big the repository is.
 */

import { createHash } from 'crypto';
import { MAX_FILE_SIZE_BYTES } from './file-filter.ts';

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

const REQUEST_HEADERS = (token: string): Record<string, string> => ({
	Accept: 'application/vnd.github+json',
	Authorization: `Bearer ${token}`,
	'X-GitHub-Api-Version': '2022-11-28',
});

/**
 * What a failed GitHub answer says. Only a 429, or a 403 with no requests left, is the
 * rate limit; any other 403 (a blocked file, missing access) is reported as it is.
 */
async function githubError(response: Response, what: string): Promise<Error> {
	if (response.status === 429 || (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')) {
		const resetHeader = response.headers.get('X-RateLimit-Reset');
		const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toISOString() : 'unknown';
		return new Error(`GitHub rate limit exceeded. Resets at ${resetAt}`);
	}
	const detail = await response.json().then((body: { message?: string }) => body.message).catch(() => undefined);
	return new Error(`${what} error: ${response.status} ${detail ?? response.statusText}`.trim());
}

/**
 * A blob's bytes, or null when it's over the size limit (reading stops there). Used for
 * what the contents API can't be trusted on: for a symlink to a regular file it answers
 * with the target's content and size, where the blob holds the link's own text.
 */
async function fetchBlobWithinLimit(owner: string, repo: string, sha: string, token: string): Promise<Buffer | null> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(sha)}`,
		{ headers: { ...REQUEST_HEADERS(token), Accept: 'application/vnd.github.raw+json' } }
	);
	if (!response.ok) throw await githubError(response, 'GitHub Blob API');
	const chunks: Buffer[] = [];
	let size = 0;
	// Returning from the loop cancels the download.
	for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > MAX_FILE_SIZE_BYTES) return null;
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** What the commit `ref` has at `path`; null when it has nothing there. */
export async function fetchTreeEntry(owner: string, repo: string, ref: string, path: string, token: string): Promise<TreeEntry | null> {
	const response = await fetch(
		`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${contentsPath(path)}?ref=${encodeURIComponent(ref)}`,
		{ headers: REQUEST_HEADERS(token) }
	);
	if (response.status === 404) return null;
	if (!response.ok) throw await githubError(response, 'GitHub Contents API');

	const body = (await response.json()) as GitHubContents | GitHubContents[];
	if (Array.isArray(body)) return { kind: 'other' };
	if (body.type === 'submodule') return { kind: 'submodule', sha: body.sha };
	if (body.type === 'symlink' && typeof body.target === 'string') {
		return { kind: 'file', sha: body.sha, size: body.size, content: Buffer.from(body.target, 'utf-8') };
	}
	if (body.type !== 'file') return { kind: 'other' };

	const inlined = body.encoding === 'base64' && typeof body.content === 'string'
		? Buffer.from(body.content, 'base64')
		: null;
	if (inlined && gitBlobSha(inlined) === body.sha) {
		return { kind: 'file', sha: body.sha, size: inlined.length, content: inlined };
	}
	// Either the content wasn't inlined (over 1 MB, or a symlink to such a file) or what
	// came isn't this blob's (a symlink to a regular file: the sha is the link's own, the
	// content and size are its target's). The blob is what the archive holds for the path.
	const blob = await fetchBlobWithinLimit(owner, repo, body.sha, token);
	return blob
		? { kind: 'file', sha: body.sha, size: blob.length, content: blob }
		: { kind: 'file', sha: body.sha, size: body.size, content: null };
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
