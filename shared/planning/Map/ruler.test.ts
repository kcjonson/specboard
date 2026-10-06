import { describe, expect, it } from 'vitest';
import { HOUR, QUIET_PAD } from './layout/constants';
import { createTimeScale, edgeOf, quietOf, ticksOf } from './layout/time-scale';
import { MIN_TICK_SPACING, QUIET_LABEL_ROOM, dayLabel, edgeLabelAt, edgeLineAt, quietLabel, rulerMarks } from './ruler';

const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-30T18:00:00Z');
const timeZone = 'UTC';

const anchors = [60, 41, 30, 22, 14, 9, 6, 3, 2, 1, 0.5, 0.1].map((d) => NOW - d * DAY).sort((a, b) => a - b);
const scale = createTimeScale(NOW, anchors, 150);
const ticks = ticksOf(scale);

const marks = (k: number, x: number, width = 1200): ReturnType<typeof rulerMarks> =>
	rulerMarks({ ticks, edge: scale.edge, edgeAt: 0, quiet: null, transform: { k, x }, width, timeZone });

describe('ruler ticks', () => {
	// A plot wide enough that nothing is cropped, so thinning is the only thing in play.
	const wide = (k: number): ReturnType<typeof rulerMarks> => marks(k, 50000, 100000);

	it('stay at least 90 px apart at any zoom', () => {
		for (const k of [0.5, 1, 2, 4, 8]) {
			const { ticks: kept } = wide(k);
			expect(kept.length).toBeGreaterThan(1);
			for (let i = 1; i < kept.length; i++) {
				expect(kept[i - 1]!.x - kept[i]!.x).toBeGreaterThanOrEqual(MIN_TICK_SPACING);
			}
		}
	});

	it('keep more days as the Map zooms in', () => {
		expect(wide(4).ticks.length).toBeGreaterThan(wide(0.5).ticks.length);
	});

	it('run right to left from the newest day, with no date at or past the edge', () => {
		const { ticks: kept, edge } = wide(1);
		expect(kept.length).toBeGreaterThan(2);
		for (const tick of kept) expect(tick.x).toBeLessThan(edge.x);
		expect(kept[0]!.label).toBe('Sep 29');
		for (let i = 1; i < kept.length; i++) expect(kept[i]!.x).toBeLessThan(kept[i - 1]!.x);
	});

	it('only draw inside the plot', () => {
		const cropped = marks(1, 800, 1200).ticks;
		expect(cropped.length).toBeGreaterThan(0);
		for (const tick of cropped) {
			expect(tick.x).toBeGreaterThanOrEqual(0);
			expect(tick.x).toBeLessThanOrEqual(1200);
		}
	});

	it('keep the same days when the Map pans, so labels do not flicker', () => {
		const days = (x: number): string[] => marks(1.5, x, 100000).ticks.map((t) => t.label);
		expect(days(50040)).toEqual(days(50000));
	});
});

describe('ruler labels', () => {
	it('write a day as month and date, adding the year once it differs from the edge', () => {
		expect(dayLabel(NOW - DAY, NOW, timeZone)).toBe('Sep 29');
		expect(dayLabel(NOW - 300 * DAY, NOW, timeZone)).toBe('Dec 4, 2025');
	});

	it('say how long a quiet break is', () => {
		const since = NOW - 6 * DAY;
		expect(quietLabel({ since, until: NOW })).toBe('then quiet 6 days');
		expect(quietLabel({ since: NOW - 13 * HOUR, until: NOW })).toBe('then quiet 13 hours');
		expect(quietLabel({ since: NOW - 40 * HOUR, until: NOW })).toBe('then quiet 2 days');
	});
});

describe('the edge and the quiet break', () => {
	const last = NOW - 6 * DAY;
	const quiet = quietOf(last, NOW)!;
	const quietScale = createTimeScale(edgeOf(last, NOW), anchors.map((t) => Math.min(t, last)), 150);
	const quietMarks = (x: number, width = 1200): ReturnType<typeof rulerMarks> =>
		rulerMarks({ ticks: ticksOf(quietScale), edge: quietScale.edge, edgeAt: 0, quiet, transform: { k: 1, x }, width, timeZone });

	it('call the edge Now on a live board', () => {
		expect(marks(1, 1100).edge).toEqual({ x: 1100, label: 'Now' });
		expect(marks(1, 1100).quiet).toBeNull();
	});

	it('call the edge the last activity on a quiet board, with a labeled break just past it', () => {
		const result = quietMarks(900);
		expect(result.edge).toEqual({ x: 900, label: 'Last activity Sep 24' });
		expect(result.quiet).toEqual({ x: 900, label: 'then quiet 6 days' });
		expect(quietScale.edge).toBe(last + QUIET_PAD);
	});

	it('draw no dates past the edge on a quiet board either', () => {
		for (const tick of quietMarks(900).ticks) expect(tick.x).toBeLessThan(900);
	});

	it('drop the break label when there is no room for it, or the edge is off screen', () => {
		expect(quietMarks(1200 - QUIET_LABEL_ROOM + 1).quiet).toBeNull();
		expect(quietMarks(-50).quiet).toBeNull();
		expect(quietMarks(1200 - QUIET_LABEL_ROOM).quiet).not.toBeNull();
	});
});

describe('edgeLabelAt', () => {
	it('hangs the label right of the edge line, and left of it when the right has no room', () => {
		const right = edgeLabelAt(600, 30, 1200)!;
		expect(right.align).toBe('left');
		expect(right.anchor).toBeGreaterThan(600);
		expect(right.box.x).toBeLessThan(right.anchor);
		const left = edgeLabelAt(1100, 30, 1200)!;
		expect(left.align).toBe('right');
		expect(left.anchor).toBeLessThan(1100);
		expect(left.box.x + left.box.w).toBeGreaterThan(left.anchor);
		expect(left.box.x + left.box.w).toBeLessThan(1100);
	});

	it('has no label, and so no box to keep off, when the edge is outside the plot', () => {
		expect(edgeLabelAt(-1, 30, 1200)).toBeNull();
		expect(edgeLabelAt(1201, 30, 1200)).toBeNull();
	});
});

describe('the edge line', () => {
	const dot = (x: number, r: number, flight: 'in_progress' | 'in_review' | null = null): { x: number; r: number; flight: string | null } => ({ x, r, flight });

	it('stays at now while work in flight sits left of it', () => {
		expect(edgeLineAt([dot(-40, 6, 'in_progress'), dot(-12, 6, 'in_review')])).toBe(0);
		expect(edgeLineAt([])).toBe(0);
	});

	it('moves just past in-flight work a moment-old completion holds right of now', () => {
		expect(edgeLineAt([dot(-40, 6), dot(30, 9, 'in_progress'), dot(12, 9, 'in_review')])).toBe(47);
	});

	it('leaves work waiting on what is in flight past the line, where the spec puts it', () => {
		const line = edgeLineAt([dot(30, 9, 'in_progress'), dot(90, 6)]);
		expect(line).toBe(47);
		expect(90 - 6).toBeGreaterThan(line);
	});

	it('draws the edge mark where the line is, with every tick still left of it', () => {
		const at = rulerMarks({ ticks, edge: scale.edge, edgeAt: 50, quiet: null, transform: { k: 2, x: 100 }, width: 1200, timeZone });
		expect(at.edge.x).toBe(200);
		for (const tick of at.ticks) expect(tick.x).toBeLessThan(at.edge.x);
	});
});
