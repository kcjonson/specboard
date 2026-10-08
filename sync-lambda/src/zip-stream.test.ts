/**
 * Streaming a GitHub archive into storage: every file entry's path lands in `kept`
 * (synced, filtered out, or failed), and the stream only finishes once every upload it
 * started has settled, so a prune that follows never races an upload still in flight.
 */

import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamGitHubZipToStorage } from './zip-stream.ts';

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

describe('streamGitHubZipToStorage', () => {
	it('stores what it can, records what it can\'t hold, and waits for every upload', async () => {
		const big = 'x'.repeat(500 * 1024 + 1);
		const archive = zip([
			['acme-docs-1234567/', ''],
			['acme-docs-1234567/docs/', ''],
			['acme-docs-1234567/docs/a.md', '# A'],
			['acme-docs-1234567/docs/b.md', '# B'],
			['acme-docs-1234567/docs/slow.md', '# Slow'],
			['acme-docs-1234567/docs/huge.md', big],
			['acme-docs-1234567/node_modules/x/README.md', '# Skipped dir'],
			['acme-docs-1234567/img/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3])],
		]);
		const fetchMock = vi.fn(async (_url: string) => new Response(new Uint8Array(archive)));
		vi.stubGlobal('fetch', fetchMock);

		const settled: string[] = [];
		const putFile = vi.fn(async (_projectId: string, path: string) => {
			await new Promise((resolve) => setTimeout(resolve, path === 'docs/slow.md' ? 80 : 10));
			settled.push(path);
			if (path === 'docs/b.md') throw new Error('500: storage unavailable');
		});
		const markUnavailable = vi.fn(async () => {});

		const head = 'a'.repeat(40);
		const result = await streamGitHubZipToStorage('acme', 'docs', head, 'token', 'p1', { putFile, markUnavailable });

		expect(fetchMock.mock.calls[0]![0]).toContain(`/zipball/${head}`);
		expect(settled.sort()).toEqual(['docs/a.md', 'docs/b.md', 'docs/slow.md']);
		expect(result.synced).toBe(2);
		expect(result.errors).toEqual(['Failed to sync docs/b.md: 500: storage unavailable']);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'docs/huge.md', 'too_large', createHash('sha1').update(big).digest('hex'), big.length);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'img/logo.png', 'binary', expect.stringMatching(/^[0-9a-f]{40}$/), 11);
		// What storage holds for the archive now: no skipped directory, no failed upload.
		expect([...result.kept].sort()).toEqual(['docs/a.md', 'docs/huge.md', 'docs/slow.md', 'img/logo.png']);
	});
});
