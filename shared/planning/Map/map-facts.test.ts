import { describe, expect, it } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { BoardBuilder, iso } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { LIVE_SESSION_MS, isLive, liveSessions } from './live-sessions';
import { mapFacts } from './map-facts';

/** One item for every row of the phases table, and the ones around it that tell the rows apart. */
function everyRow(): { b: BoardBuilder; byPhase: Record<'done' | 'in_flight' | 'next' | 'later', MapItemRow[]> } {
	const b = new BoardBuilder();
	const open = b.add({ status: 'in_progress' });
	const done = [b.add({ status: 'done' }), b.add({ status: 'done' })];
	const inFlight = [
		b.add({ status: 'in_progress' }),
		b.add({ status: 'in_review' }),
		// Blocked or not, in progress and in review are in flight.
		b.add({ status: 'in_progress', blocked: true }),
		b.add({ status: 'in_review', blocked: true }),
		// A hold that had started is still in flight.
		b.add({ status: 'blocked', blocked: true, started: b.now - 86_400_000 }),
	];
	const next = [b.add({ status: 'ready' }), b.add({ status: 'ready', subStatus: 'scoping' })];
	const later = [
		// Ready with an open blocker.
		b.add({ status: 'ready', blocked: true }),
		// A hold that never started.
		b.add({ status: 'blocked', blocked: true }),
		// Ready with a text blocker is held too.
		b.add({ status: 'ready', blocked: true, textBlockerCount: 1 }),
	];
	b.block(later[0]!, open);
	return { b, byPhase: { done, in_flight: [open, ...inFlight], next, later } };
}

const factsOf = (b: BoardBuilder, now = b.now): ReturnType<typeof mapFacts> => {
	const layout = layoutMap({ rows: b.rows, now, collapse: {}, aspect: 2 });
	return mapFacts(layout, new Map(b.rows.map((row) => [row.key, row])), now);
};

describe('summary counts', () => {
	it('puts every item in exactly one phase, by every row of the phases table', () => {
		const { b, byPhase } = everyRow();
		const { summary } = factsOf(b);
		expect(summary.phases).toEqual({ done: 2, in_flight: 6, next: 2, later: 3 });
		expect(Object.values(summary.phases).reduce((a, n) => a + n, 0)).toBe(b.rows.length);
		expect(byPhase.in_flight).toHaveLength(6);
	});

	it('counts Next as exactly what the ready list returns: ready, blocked excluded', () => {
		const { b } = everyRow();
		const ready = b.rows.filter((row) => row.status === 'ready' && !row.blocked);
		expect(factsOf(b).summary.phases.next).toBe(ready.length);
	});

	it('counts what reads Blocked under any unfinished status, in flight work included', () => {
		const { b } = everyRow();
		// Two blocked in-flight, a started hold, a ready with a blocker, a never-started hold, and a text hold.
		expect(factsOf(b).summary.blocked).toBe(6);
	});

	it('counts the finished work a read past its cap folded into one row as done', () => {
		const b = new BoardBuilder();
		b.add({ type: 'epic', status: 'done', summarizedDescendants: 40 });
		b.add({ status: 'ready' });
		expect(factsOf(b).summary.phases).toEqual({ done: 41, in_flight: 0, next: 1, later: 0 });
	});

	it('counts the items that need a person once each, whatever their reasons', () => {
		const b = new BoardBuilder();
		b.add({ status: 'in_progress', subStatus: 'needs_input', textBlockerCount: 1 });
		b.add({ status: 'in_review' });
		b.add({ status: 'ready', blocked: true, textBlockerCount: 2 });
		b.add({ status: 'in_progress' });
		const first = b.add({ status: 'ready' });
		const second = b.add({ status: 'ready' });
		b.block(first, second);
		b.block(second, first);
		const { summary, needs } = factsOf(b);
		expect(summary.needsPerson).toBe(5);
		expect(needs.size).toBe(5);
	});

	it('counts distinct live sessions, not episodes', () => {
		const b = new BoardBuilder();
		const one = b.add({ status: 'in_progress' });
		const two = b.add({ status: 'in_progress' });
		b.work(one, 'session-a', 'laptop', 2);
		b.work(two, 'session-a', 'laptop', 2);
		b.work(two, 'session-b', 'desktop', 14);
		const quiet = b.add({ status: 'in_progress' });
		b.work(quiet, 'session-c', 'desktop', 40);
		const facts = factsOf(b);
		expect(facts.summary.liveSessions).toBe(2);
		expect([...facts.liveItems].sort()).toEqual([one.key, two.key].sort());
	});
});

describe('live sessions', () => {
	it('is live for 15 minutes after the last write, and not after', () => {
		const now = Date.parse('2026-09-30T18:00:00Z');
		expect(LIVE_SESSION_MS).toBe(15 * 60_000);
		expect(isLive(now - 15 * 60_000, now)).toBe(true);
		expect(isLive(now - 15 * 60_000 - 1, now)).toBe(false);
	});

	it('reads the rule from the episodes the read carries', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'in_progress' });
		item.workers.push({ sessionKey: 'k', deviceName: 'laptop', client: null, branch: null, lastWriteAt: iso(b.now - 16 * 60_000) });
		expect(liveSessions(b.rows, b.now).sessions.size).toBe(0);
		item.workers[0]!.lastWriteAt = iso(b.now - 60_000);
		expect([...liveSessions(b.rows, b.now).sessions]).toEqual(['k']);
	});
});
