import { describe, expect, it } from 'vitest';
import { HOUR, QUIET_PAD } from './constants';
import { createTimeScale, edgeOf, quietOf, ticksOf, timeToX } from './time-scale';

const NOW = Date.parse('2026-09-30T18:00:00Z');
const DAY = 24 * HOUR;

describe('time scale', () => {
	const times = [40, 30, 20, 10, 6, 3, 2, 1, 0.5, 0.1].map((d) => NOW - d * DAY).sort((a, b) => a - b);
	const scale = createTimeScale(NOW, times, 120);

	it('puts the edge at 0 and the past to its left, in order', () => {
		expect(timeToX(scale, NOW)).toBeCloseTo(0);
		let previous = Infinity;
		for (let d = 0.05; d < 45; d *= 1.5) {
			const x = timeToX(scale, NOW - d * DAY);
			expect(x).toBeLessThan(previous);
			previous = x;
		}
	});

	it('gives each stretch room for how much happened in it on the equalized scale', () => {
		const equal = { ...scale, equalized: 1 };
		const room = (from: number, to: number): number => timeToX(equal, NOW - to * DAY) - timeToX(equal, NOW - from * DAY);
		// Three anchors from 41 to 15 days ago, four in the last two and a half days.
		expect(room(41, 15) / room(2.5, 0)).toBeCloseTo(3 / 4);
	});

	it('lays a tick per day back to the oldest anchor, right to left', () => {
		const ticks = ticksOf(scale);
		expect(ticks).toHaveLength(40);
		expect(ticks[0]!.time).toBe(NOW - DAY);
		for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.x).toBeLessThan(ticks[i - 1]!.x);
	});

	it('ends a quiet board just past its last activity and reports the break', () => {
		const last = NOW - 6 * DAY;
		expect(edgeOf(last, NOW)).toBe(last + QUIET_PAD);
		expect(quietOf(last, NOW)).toEqual({ since: last, until: NOW });
		expect(edgeOf(NOW - 11 * HOUR, NOW)).toBe(NOW);
		expect(quietOf(NOW - 11 * HOUR, NOW)).toBeNull();
	});

	it('survives an empty board', () => {
		const empty = createTimeScale(NOW, [], 120);
		expect(timeToX(empty, NOW)).toBeCloseTo(0);
		expect(ticksOf(empty)).toEqual([]);
	});
});
