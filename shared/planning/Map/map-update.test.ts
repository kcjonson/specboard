import { describe, expect, it } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { BoardBuilder, NOW, iso } from './layout/board-fixture';
import { changedKeys, changesAnything, diffRows } from './map-update';

const byKey = (rows: MapItemRow[]): Map<string, MapItemRow> => new Map(rows.map((row) => [row.key, row]));

function rows(): MapItemRow[] {
	const b = new BoardBuilder();
	const blocker = b.add({ status: 'in_progress' });
	const waiting = b.add({ status: 'ready' });
	b.block(waiting, blocker);
	b.work(blocker, 'session-a', 'laptop', 20);
	b.add({ status: 'ready' });
	return b.rows;
}

describe('diffRows', () => {
	it('finds nothing in a read that repeats every row', () => {
		const before = rows();
		const update = diffRows(byKey(before), byKey(before.map((row) => ({ ...row, workers: [...row.workers], blockers: [...row.blockers] }))));
		expect(changesAnything(update)).toBe(false);
	});

	it('names what arrived and what is gone', () => {
		const before = rows();
		const after = [...before.slice(1), { ...before[2]!, key: 'MAP-9' }];
		const update = diffRows(byKey(before), byKey(after));
		expect([...update.added]).toEqual(['MAP-9']);
		expect([...update.removed]).toEqual([before[0]!.key]);
	});

	it('restyles a status, sub-status, or blocked change, and moves it when the layout reads it', () => {
		const before = rows();
		const after = before.map((row, i) => (i === 2 ? { ...row, status: 'done' as const, completedAt: iso(NOW), timeAnchor: iso(NOW) } : i === 1 ? { ...row, subStatus: 'needs_input' as const } : row));
		const update = diffRows(byKey(before), byKey(after));
		expect([...update.restyled].sort()).toEqual([before[1]!.key, before[2]!.key].sort());
		expect([...update.moved]).toEqual([before[2]!.key]);
	});

	it('moves an item whose anchor, links, or sessions changed, and leaves a retitled one in place', () => {
		const before = rows();
		const after = before.map((row, i) => (i === 0 ? { ...row, title: 'renamed' } : i === 1 ? { ...row, blockers: [] } : { ...row, timeAnchor: iso(NOW + 1) }));
		const update = diffRows(byKey(before), byKey(after));
		expect([...update.moved].sort()).toEqual([before[1]!.key, before[2]!.key].sort());
		expect(changedKeys(update).has(before[0]!.key)).toBe(false);
	});

	it('names an agent write: a session new to the item, or one whose last write moved', () => {
		const before = rows();
		const [episode] = before[0]!.workers;
		const later = { ...episode!, lastWriteAt: iso(Date.parse(episode!.lastWriteAt) + 60_000) };
		const fresh = { ...episode!, sessionKey: 'session-b' };
		const after = before.map((row, i) => (i === 0 ? { ...row, workers: [later] } : i === 2 ? { ...row, workers: [fresh] } : row));
		const update = diffRows(byKey(before), byKey(after));
		expect([...update.wrote].sort()).toEqual([before[0]!.key, before[2]!.key].sort());
		// A write alone isn't flashed under reduced motion: the glow says it.
		expect(changedKeys({ ...update, moved: new Set(), restyled: new Set() }).size).toBe(0);
	});
});
