/**
 * Paths go into storage URLs encoded segment by segment, so a name with #, ?, %, a
 * space, or non-ASCII characters reaches the service as itself instead of being cut
 * short at a fragment or query.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { StorageClient } from './storage-client.ts';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('StorageClient paths', () => {
	it.each([
		['getFile', (c: StorageClient) => c.getFile('p1', 'docs/C# notes?/100% ü.md'), '/files/p1/docs/C%23%20notes%3F/100%25%20%C3%BC.md'],
		['getPendingChange', (c: StorageClient) => c.getPendingChange('p1', 'u1', 'docs/C#.md'), '/pending/p1/u1/docs/C%23.md'],
		['putPendingChange', (c: StorageClient) => c.putPendingChange('p1', 'u1', 'docs/a?b.md', 'x', 'created', null), '/pending/p1/u1/docs/a%3Fb.md'],
		['deletePendingChange', (c: StorageClient) => c.deletePendingChange('p1', 'u1', 'docs/50%.md'), '/pending/p1/u1/docs/50%25.md'],
	])('%s encodes the path', async (_name, callIt, expected) => {
		const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ path: 'x', content: '' }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await callIt(new StorageClient('http://storage', 'key'));

		expect(fetchMock.mock.calls[0]![0]).toBe(`http://storage${expected}`);
	});
});
