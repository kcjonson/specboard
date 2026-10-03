import { describe, expect, it } from 'vitest';
import { HOUR, QUIET_PAD } from './layout/constants';
import { createTimeScale, edgeOf, quietOf, ticksOf } from './layout/time-scale';
import { MIN_TICK_SPACING, QUIET_LABEL_ROOM, dayLabel, quietLabel, rulerMarks } from './ruler';

const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-30T18:00:00Z');
const timeZone = 'UTC';

const anchors = [60, 41, 30, 22, 14, 9, 6, 3, 2, 1, 0.5, 0.1].map((d) => NOW - d * DAY).sort((a, b) => a - b);
const scale = createTimeScale(NOW, anchors, 150);
const ticks = ticksOf(scale);

const marks = (k: number, x: number, width = 1200): ReturnType<typeof rulerMarks> =>
	rulerMarks({ ticks, edge: scale.edge, quiet: null, transform: { k, x }, width, timeZone });

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
		rulerMarks({ ticks: ticksOf(quietScale), edge: quietScale.edge, quiet, transform: { k: 1, x }, width, timeZone });

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
