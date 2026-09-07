/**
 * validatePath tests — symlink-aware containment for paths that don't exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { validatePath } from './git-utils.ts';

let sandbox: string;
let repo: string;
let outside: string;

beforeEach(async () => {
	sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'validate-path-'));
	repo = path.join(sandbox, 'repo');
	outside = path.join(sandbox, 'outside');
	await fs.mkdir(repo);
	await fs.mkdir(outside);
	await fs.symlink(outside, path.join(repo, 'link'), 'dir');
});

afterEach(async () => {
	await fs.rm(sandbox, { recursive: true, force: true });
});

describe('validatePath', () => {
	it('rejects a new file under a symlink that points outside the repo', async () => {
		await expect(validatePath(repo, '/link/newfile.md')).rejects.toThrow('Path traversal detected');
	});

	it('rejects a new file under missing directories below an escaping symlink', async () => {
		await expect(validatePath(repo, '/link/a/b/newfile.md')).rejects.toThrow('Path traversal detected');
	});

	it('rejects an existing file reached through an escaping symlink', async () => {
		await fs.writeFile(path.join(outside, 'secret.md'), 'x');
		await expect(validatePath(repo, '/link/secret.md')).rejects.toThrow('Path traversal detected');
	});

	it('rejects dot-dot traversal to a path that does not exist', async () => {
		await expect(validatePath(repo, '/../outside/newfile.md')).rejects.toThrow('Path traversal detected');
	});

	it('resolves a new file directly under the repo', async () => {
		await expect(validatePath(repo, '/newfile.md')).resolves.toBe(path.join(repo, 'newfile.md'));
	});

	it('treats repeated leading separators as repo-relative', async () => {
		await expect(validatePath(repo, '//newfile.md')).resolves.toBe(path.join(repo, 'newfile.md'));
	});

	it('resolves a new file under directories that do not exist yet', async () => {
		await expect(validatePath(repo, '/docs/nested/newfile.md')).resolves.toBe(
			path.join(repo, 'docs', 'nested', 'newfile.md')
		);
	});

	it('resolves the repo root itself', async () => {
		await expect(validatePath(repo, '/')).resolves.toBe(repo);
	});
});
