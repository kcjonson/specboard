/**
 * The sync's storage client: it waits out a 429 as Retry-After says instead of failing
 * the sync, doesn't retry other refusals, encodes every path segment, and identifies
 * itself as sync traffic (which the storage service rate-limits on its own budget).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStorageClient, storageUrlPath } from './storage-client.ts';

function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createStorageClient', () => {
	it('waits as long as Retry-After says on a 429, then goes on', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(respond(429, { error: 'Too many requests' }, { 'Retry-After': '7' }))
			.mockResolvedValueOnce(respond(200));
		vi.stubGlobal('fetch', fetchMock);
		const sleep = vi.fn(async () => {});

		await createStorageClient('http://storage', 'key', { sleep }).putFile('p1', 'docs/a.md', '# A');

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(7000);
	});

	it('stops retrying, without waiting, once the caller says there is no time for the wait', async () => {
		const fetchMock = vi.fn(async () => respond(429, { error: 'Too many requests' }, { 'Retry-After': '45' }));
		vi.stubGlobal('fetch', fetchMock);
		const sleep = vi.fn(async () => {});
		const beforeSleep = vi.fn((ms: number) => {
			if (ms > 30_000) throw new Error('out of time');
		});

		await expect(createStorageClient('http://storage', 'key', { sleep, beforeSleep }).putFile('p1', 'a.md', 'x'))
			.rejects.toThrow('out of time');
		expect(beforeSleep).toHaveBeenCalledWith(45_000);
		expect(sleep).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('gives up on a 429 after its retries', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(429, { error: 'Too many requests' }, { 'Retry-After': '1' })));
		const sleep = vi.fn(async () => {});

		await expect(createStorageClient('http://storage', 'key', { sleep, maxRateLimitRetries: 2 }).putFile('p1', 'a.md', 'x'))
			.rejects.toThrow('429');
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('doesn\'t retry another refusal, and does retry a server error', async () => {
		const sleep = vi.fn(async () => {});
		const refused = vi.fn(async () => respond(400, { error: 'Invalid path' }));
		vi.stubGlobal('fetch', refused);
		await expect(createStorageClient('http://storage', 'key', { sleep }).putFile('p1', 'a.md', 'x')).rejects.toThrow('400');
		expect(refused).toHaveBeenCalledTimes(1);

		const flaky = vi.fn().mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));
		vi.stubGlobal('fetch', flaky);
		await createStorageClient('http://storage', 'key', { sleep }).putFile('p1', 'a.md', 'x');
		expect(flaky).toHaveBeenCalledTimes(2);
	});

	it('encodes each path segment and says it\'s the sync', async () => {
		const fetchMock = vi.fn(async () => respond(200));
		vi.stubGlobal('fetch', fetchMock);

		await createStorageClient('http://storage', 'key').deleteFile('p1', 'docs/C# notes?/100% ü.md');

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://storage/files/p1/docs/C%23%20notes%3F/100%25%20%C3%BC.md');
		expect((init.headers as Record<string, string>)['X-Storage-Client']).toBe('sync');
	});
});

describe('storageUrlPath', () => {
	it('round-trips through decoding, segment by segment', () => {
		const path = 'docs/C#/a?b/100%/space name/ünïcødé.md';
		expect(storageUrlPath(path).split('/').map(decodeURIComponent).join('/')).toBe(path);
	});
});
