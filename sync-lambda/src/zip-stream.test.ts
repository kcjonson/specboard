/**
 * Streaming a GitHub archive into storage: every file entry's path lands in `kept`
 * (synced, recorded as unavailable, or failed), the stream only finishes once every
 * upload it started has settled, and no recursive tree listing is needed: a file too
 * large to hold is named by a git blob sha taken from its own bytes.
 */

import { crc32 } from 'node:zlib';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamGitHubZipToStorage } from './zip-stream.ts';
import { gitBlobSha } from './tree.ts';
import { SyncOutOfTimeError, UNLIMITED_TIME, type TimeBudget } from './time-budget.ts';

interface ZipEntry {
	name: string;
	body: string | Buffer;
	/** Leave the sizes out of the local header and put them in a data descriptor after the bytes. */
	deferSize?: boolean;
}

/** A zip of stored (uncompressed) entries; a name ending in "/" is a directory. */
function zip(entries: Array<ZipEntry | [string, string | Buffer]>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const item of entries) {
		const { name, body, deferSize = false } = Array.isArray(item) ? { name: item[0], body: item[1] } : item;
		const data = typeof body === 'string' ? Buffer.from(body) : body;
		const nameBytes = Buffer.from(name);
		const crc = crc32(data);
		const flags = deferSize ? 0x08 : 0;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		if (!deferSize) {
			local.writeUInt32LE(crc, 14);
			local.writeUInt32LE(data.length, 18);
			local.writeUInt32LE(data.length, 22);
		}
		local.writeUInt16LE(nameBytes.length, 26);
		locals.push(local, nameBytes, data);
		let written = 30 + nameBytes.length + data.length;
		if (deferSize) {
			const descriptor = Buffer.alloc(16);
			descriptor.writeUInt32LE(0x08074b50, 0);
			descriptor.writeUInt32LE(crc, 4);
			descriptor.writeUInt32LE(data.length, 8);
			descriptor.writeUInt32LE(data.length, 12);
			locals.push(descriptor);
			written += 16;
		}

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBytes);

		offset += written;
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

/** GitHub, serving this archive for any zipball and these entries from the contents API. */
function github(archive: Buffer, contents: Record<string, object> = {}): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (url: string) => {
		if (url.includes('/zipball/')) return new Response(new Uint8Array(archive));
		const path = decodeURIComponent(new URL(url).pathname.split('/contents/')[1] ?? '');
		const entry = contents[path];
		return entry ? Response.json(entry) : new Response('Not Found', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** Text that isn't binary, `size` bytes of it. */
function text(size: number): Buffer {
	return Buffer.alloc(size, 'abcdefghij\n');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('git blob sha', () => {
	it('matches the sha GitHub gives the same bytes', () => {
		// `printf 'hello\n' | git hash-object --stdin`, and the empty blob every repository shares.
		expect(gitBlobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
		expect(gitBlobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	});
});

describe('streamGitHubZipToStorage', () => {
	it('stores what it can, records what it can\'t hold, and waits for every upload', async () => {
		const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
		const huge = text(600_000);
		const fetchMock = github(zip([
			['acme-docs-1234567/', ''],
			['acme-docs-1234567/docs/', ''],
			['acme-docs-1234567/docs/a.md', '# A'],
			['acme-docs-1234567/docs/b.md', '# B'],
			['acme-docs-1234567/docs/slow.md', '# Slow'],
			['acme-docs-1234567/docs/huge.md', huge],
			['acme-docs-1234567/node_modules/x/README.md', '# Skipped dir'],
			['acme-docs-1234567/img/logo.png', binary],
		]));

		const settled: string[] = [];
		const putFile = vi.fn(async (_projectId: string, path: string) => {
			await new Promise((resolve) => setTimeout(resolve, path === 'docs/slow.md' ? 80 : 10));
			settled.push(path);
			if (path === 'docs/b.md') throw new Error('500: storage unavailable');
		});
		const markUnavailable = vi.fn(async () => {});

		const head = 'a'.repeat(40);
		const result = await streamGitHubZipToStorage('acme', 'docs', head, 'token', 'p1', { putFile, markUnavailable }, UNLIMITED_TIME);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]![0]).toContain(`/zipball/${head}`);
		expect(settled.sort()).toEqual(['docs/a.md', 'docs/b.md', 'docs/slow.md']);
		expect(result.synced).toBe(2);
		expect(result.errors).toEqual(['Failed to sync docs/b.md: 500: storage unavailable']);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'docs/huge.md', 'too_large', gitBlobSha(huge), 600_000);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'img/logo.png', 'binary', gitBlobSha(binary), 11);
		// What storage holds for the archive now: no skipped directory, no failed upload.
		expect([...result.kept].sort()).toEqual(['docs/a.md', 'docs/huge.md', 'docs/slow.md', 'img/logo.png']);
	});

	it('leaves a submodule alone: the archive has only its empty folder', async () => {
		github(zip([
			['acme-docs-1/', ''],
			['acme-docs-1/docs/a.md', '# A'],
			['acme-docs-1/vendor/lib/', ''],
		]));
		const putFile = vi.fn(async () => {});
		const markUnavailable = vi.fn(async () => {});

		const result = await streamGitHubZipToStorage('acme', 'docs', 'a'.repeat(40), 'token', 'p1', { putFile, markUnavailable }, UNLIMITED_TIME);

		expect(result.errors).toEqual([]);
		expect([...result.kept]).toEqual(['docs/a.md']);
		expect(markUnavailable).not.toHaveBeenCalled();
	});

	it('asks GitHub for the sha of an oversize file whose size the archive deferred', async () => {
		const huge = text(600_000);
		const fetchMock = github(
			zip([
				['acme-docs-1/', ''],
				{ name: 'acme-docs-1/docs/streamed.md', body: huge, deferSize: true },
				{ name: 'acme-docs-1/docs/small.md', body: '# Small', deferSize: true },
			]),
			{ 'docs/streamed.md': { type: 'file', sha: gitBlobSha(huge), size: huge.length } }
		);
		const putFile = vi.fn(async () => {});
		const markUnavailable = vi.fn(async () => {});

		const result = await streamGitHubZipToStorage('acme', 'docs', 'a'.repeat(40), 'token', 'p1', { putFile, markUnavailable }, UNLIMITED_TIME);

		expect(result.errors).toEqual([]);
		expect(markUnavailable).toHaveBeenCalledWith('p1', 'docs/streamed.md', 'too_large', gitBlobSha(huge), 600_000);
		expect(putFile).toHaveBeenCalledWith('p1', 'docs/small.md', '# Small');
		expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/contents/'))).toHaveLength(1);
	});

	it('stops reading once out of time, after what it started has settled', async () => {
		const files = Array.from({ length: 30 }, (_, i): [string, string] => [`acme-docs-1/docs/${i}.md`, `# ${i}`]);
		github(zip(files));
		let checks = 0;
		const budget: TimeBudget = {
			check(): void {
				if (++checks > 5) throw new SyncOutOfTimeError();
			},
		};
		let active = 0;
		const putFile = vi.fn(async () => {
			active++;
			await new Promise((resolve) => setTimeout(resolve, 20));
			active--;
		});

		await expect(
			streamGitHubZipToStorage('acme', 'docs', 'a'.repeat(40), 'token', 'p1', { putFile, markUnavailable: vi.fn() }, budget)
		).rejects.toBeInstanceOf(SyncOutOfTimeError);
		expect(putFile).toHaveBeenCalledTimes(5);
		expect(active).toBe(0);
	});

	it('keeps at most ten uploads in flight', async () => {
		const files = Array.from({ length: 30 }, (_, i): [string, string] => [`acme-docs-1/docs/${i}.md`, `# ${i}`]);
		github(zip(files));
		let active = 0;
		let peak = 0;
		const putFile = vi.fn(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
		});

		const result = await streamGitHubZipToStorage('acme', 'docs', 'a'.repeat(40), 'token', 'p1', { putFile, markUnavailable: vi.fn() }, UNLIMITED_TIME);

		expect(result.synced).toBe(30);
		expect(peak).toBeLessThanOrEqual(10);
		expect(peak).toBeGreaterThan(1);
	});
});
