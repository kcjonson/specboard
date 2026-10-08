/**
 * Streaming a GitHub archive into storage: every file entry's path lands in `kept`
 * (synced, filtered out, or failed), and the stream only finishes once every upload it
 * started has settled, so a prune that follows never races an upload still in flight.
 */

import { crc32 } from 'node:zlib';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamGitHubZipToStorage } from './zip-stream.ts';
import type { TreeEntry } from './tree.ts';

/** A zip of stored (uncompressed) entries; a name ending in "/" is a directory. */
function zip(entries: Array<[string, string | Buffer]>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, body] of entries) {
		const data = typeof body === 'string' ? Buffer.from(body) : body;
		const nameBytes = Buffer.from(name);
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		locals.push(local, nameBytes, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBytes);

		offset += 30 + nameBytes.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A tree listing for these archive paths, as blobs of their own size (sha = path). */
function treeOf(files: Array<[string, number]>): Map<string, TreeEntry> {
	return new Map(files.map(([path, size]) => [path, { sha: `sha-${path}`, size, submodule: false }]));
}

describe('streamGitHubZipToStorage', () => {
	it('stores what it can, records what it can\'t hold from the tree, and waits for every upload', async () => {
		const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
		const archive = zip([
			['acme-docs-1234567/', ''],
			['acme-docs-1234567/docs/', ''],
			['acme-docs-1234567/docs/a.md', '# A'],
			['acme-docs-1234567/docs/b.md', '# B'],
			['acme-docs-1234567/docs/slow.md', '# Slow'],
			['acme-docs-1234567/docs/huge.md', '# Listed as huge'],
			['acme-docs-1234567/docs/stray.md', '# Not in the tree'],
			['acme-docs-1234567/node_modules/x/README.md', '# Skipped dir'],
			['acme-docs-1234567/img/logo.png', binary],
		]);
		const fetchMock = vi.fn(async (_url: string) => new Response(new Uint8Array(archive)));
		vi.stubGlobal('fetch', fetchMock);
		const tree = treeOf([['docs/a.md', 3], ['docs/b.md', 3], ['docs/slow.md', 6], ['docs/huge.md', 600_000], ['img/logo.png', 11]]);

		const settled: string[] = [];
		const putFile = vi.fn(async (_projectId: string, path: string) => {
			await new Promise((resolve) => setTimeout(resolve, path === 'docs/slow.md' ? 80 : 10));
			settled.push(path);
			if (path === 'docs/b.md') throw new Error('500: storage unavailable');
		});
		const markUnavailable = vi.fn(async () => {});

		const head = 'a'.repeat(40);
		const result = await streamGitHubZipToStorage('acme', 'docs', head, 'token', 'p1', { putFile, markUnavailable }, tree);

		expect(fetchMock.mock.calls[0]![0]).toContain(`/zipball/${head}`);
		expect(settled.sort()).toEqual(['docs/a.md', 'docs/b.md', 'docs/slow.md']);
		expect(result.synced).toBe(2);
		expect(result.errors.sort()).toEqual([
			'Failed to sync docs/b.md: 500: storage unavailable',
			'Failed to sync docs/stray.md: not in the commit\'s tree',
		]);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'docs/huge.md', 'too_large', 'sha-docs/huge.md', 600_000);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'img/logo.png', 'binary', 'sha-img/logo.png', 11);
		// What storage holds for the archive now: no skipped directory, no failed upload.
		expect([...result.kept].sort()).toEqual(['docs/a.md', 'docs/huge.md', 'docs/slow.md', 'img/logo.png']);
	});

	it('keeps at most ten uploads in flight', async () => {
		const files = Array.from({ length: 30 }, (_, i): [string, string] => [`acme-docs-1/docs/${i}.md`, `# ${i}`]);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(zip(files)))));
		let active = 0;
		let peak = 0;
		const putFile = vi.fn(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
		});

		const tree = treeOf(files.map(([path, body]) => [path.replace('acme-docs-1/', ''), body.length]));
		const result = await streamGitHubZipToStorage('acme', 'docs', 'a'.repeat(40), 'token', 'p1', { putFile, markUnavailable: vi.fn() }, tree);

		expect(result.synced).toBe(30);
		expect(peak).toBeLessThanOrEqual(10);
		expect(peak).toBeGreaterThan(1);
	});
});
