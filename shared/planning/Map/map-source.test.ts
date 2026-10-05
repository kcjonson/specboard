import { describe, expect, it, vi } from 'vitest';
import { encodeMapRead } from '@specboard/core/map-read';
import { BoardBuilder, wholeRead } from './layout/board-fixture';

const get = vi.fn();

vi.mock('@specboard/fetch', () => ({ fetchClient: { get: (...args: unknown[]) => get(...args) } }));

const { createMapSource } = await import('./map-source');

describe('createMapSource', () => {
	it('reads the project route and decodes the columns back into rows', async () => {
		const b = new BoardBuilder();
		const blocker = b.add({ status: 'in_progress' });
		const waiting = b.add({ status: 'ready' });
		b.block(waiting, blocker);
		b.work(blocker, 'session-a', 'laptop');
		const read = wholeRead(b.rows);
		get.mockResolvedValue(encodeMapRead(read, 'MAP'));

		const result = await createMapSource('acme/specboard')(null);

		expect(get).toHaveBeenCalledWith('/api/projects/acme/specboard/map');
		expect(result.summarized).toBe(false);
		expect(result.cursor).toBe(read.cursor);
		expect(result.items.map((row) => row.key)).toEqual(read.items.map((row) => row.key));
		expect(result.items[1]!.blockers).toEqual([{ blockerKey: blocker.key, state: 'open' }]);
		expect(result.items[0]!.workers[0]).toMatchObject({ sessionKey: 'session-a', deviceName: 'laptop' });
	});

	it('asks for what changed since a cursor', async () => {
		get.mockResolvedValue(encodeMapRead({ ...wholeRead([]), delta: true, cursor: 1_790_000_009_000 }, 'MAP'));

		const result = await createMapSource('acme/specboard')(1_790_000_000_000);

		expect(get).toHaveBeenCalledWith('/api/projects/acme/specboard/map?since=1790000000000');
		expect(result).toMatchObject({ delta: true, cursor: 1_790_000_009_000 });
	});

	it('lets a failed read through for the error state', async () => {
		get.mockRejectedValue(new Error('HTTP 500'));
		await expect(createMapSource('acme/specboard')(null)).rejects.toThrow('HTTP 500');
	});
});
