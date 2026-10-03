import { describe, expect, it } from 'vitest';
import { decodeMapRead, encodeMapRead, type MapItemRow, type MapRead } from './map-read.ts';

const row = (fields: Partial<MapItemRow> & Pick<MapItemRow, 'key'>): MapItemRow => ({
	type: 'task', title: 'A task', status: 'ready', subStatus: 'not_started', blocked: false, parentKey: null, rank: 1,
	createdAt: '2026-09-01T10:00:00.123Z', startedAt: null, completedAt: null, timeAnchor: '2026-09-01T10:00:00.123Z',
	workers: [], blockers: [], textBlockerCount: 0, discoveredFromKey: null, originActorType: 'user', prUrl: null,
	specCount: 0, ...fields,
});

const READ: MapRead = {
	summarized: true,
	items: [
		row({ key: 'SPE-1', type: 'epic', status: 'done', subStatus: 'complete', completedAt: '2026-09-03T00:00:00.000Z',
			timeAnchor: '2026-09-04T08:30:00.456Z', summarizedDescendants: 12, originActorType: null }),
		row({
			key: 'SPE-12', parentKey: 'SPE-9', status: 'in_progress', subStatus: 'pr_open', rank: 2.5, blocked: true,
			startedAt: '2026-09-02T00:00:00.001Z', timeAnchor: '2026-09-05T12:00:00.999Z',
			workers: [{ sessionKey: 'AbCdEfGhIjKlMnOp', deviceName: 'laptop', client: 'claude-code', branch: 'feat/x', lastWriteAt: '2026-09-05T12:00:00.999Z' }],
			blockers: [{ blockerKey: 'SPE-1', state: 'satisfied', satisfiedAt: '2026-09-03T00:00:00.000Z' }, { blockerKey: 'SPE-3', state: 'open' }],
			textBlockerCount: 2, discoveredFromKey: 'SPE-1', originActorType: 'agent', prUrl: 'https://github.com/acme/roadmap/pull/7', specCount: 1,
		}),
	],
};

describe('the map read on the wire', () => {
	it('decodes to exactly the rows it encoded', () => {
		const wire = JSON.parse(JSON.stringify(encodeMapRead(READ, 'SPE')));
		expect(decodeMapRead(wire)).toEqual(READ);
	});

	it('sends keys as numbers, times as epoch ms, and links in their short form', () => {
		const wire = encodeMapRead(READ, 'SPE');
		expect(wire.number).toEqual([1, 12]);
		expect(wire.parent).toEqual([null, 9]);
		expect(wire.timeAnchor).toEqual([Date.parse('2026-09-04T08:30:00.456Z'), Date.parse('2026-09-05T12:00:00.999Z')]);
		expect(wire.blockers).toEqual([[], [[1, Date.parse('2026-09-03T00:00:00.000Z')], 3]]);
		expect(wire.summarizedDescendants).toEqual([12, null]);
		expect(wire.workers[1]![0]!.lastWriteAt).toBe(Date.parse('2026-09-05T12:00:00.999Z'));
	});

	it('refuses a key from another project rather than sending a wrong number', () => {
		expect(() => encodeMapRead({ summarized: false, items: [row({ key: 'XX-1' })] }, 'SPE')).toThrow('XX-1');
	});

	it('encodes an empty project', () => {
		expect(decodeMapRead(encodeMapRead({ items: [], summarized: false }, 'SPE'))).toEqual({ items: [], summarized: false });
	});
});
