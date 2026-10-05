import { describe, expect, it } from 'vitest';
import { HOUR, QUIET_PAD } from './constants';
import { createTimeScale, edgeOf, quietOf, shiftX, ticksOf, timeToX } from './time-scale';

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

	it('keeps the edge at 0 when an anchor runs ahead of it', () => {
		const skewed = createTimeScale(NOW, [...times, NOW + 5 * 60_000], 120);
		expect(timeToX(skewed, NOW)).toBeCloseTo(0);
		expect(timeToX(skewed, NOW + 5 * 60_000)).toBeCloseTo(0);
		expect(timeToX(skewed, NOW - DAY)).toBeLessThan(0);
	});

	it('survives an empty board', () => {
		const empty = createTimeScale(NOW, [], 120);
		expect(timeToX(empty, NOW)).toBeCloseTo(0);
		expect(ticksOf(empty)).toEqual([]);
	});
});

describe('time drift', () => {
	const times = [40, 30, 20, 10, 6, 3, 2, 1, 1, 0.5, 0.1].map((d) => NOW - d * DAY).sort((a, b) => a - b);
	const before = createTimeScale(NOW, times, 120);
	// Ten minutes on, and one item's activity moved from a day back to now.
	const later = NOW + 10 * 60_000;
	const after = createTimeScale(later, [...times.slice(0, 7), ...times.slice(8), later].sort((a, b) => a - b), 120);

	it('leaves every point where it was when the scale has not moved', () => {
		for (const x of [-500, -300.5, -120, -60.25, -12, -0.5]) expect(shiftX(before, before, x)).toBeCloseTo(x, 6);
		for (const time of times) expect(shiftX(before, before, timeToX(before, time))).toBeCloseTo(timeToX(before, time), 6);
	});

	it('carries a point at a moment to that moment on the new scale', () => {
		for (const d of [35, 15, 4, 0.3]) {
			const time = NOW - d * DAY;
			expect(shiftX(before, after, timeToX(before, time))).toBeCloseTo(timeToX(after, time), 6);
		}
	});

	it('slides the past left as now moves on, recent work the furthest', () => {
		const drifted = createTimeScale(later, times, 120);
		const moved = (x: number): number => shiftX(before, drifted, x) - x;
		const old = timeToX(before, NOW - 30 * DAY - 1);
		const recent = timeToX(before, NOW - 0.2 * DAY);
		expect(moved(old)).toBeLessThan(0);
		expect(moved(recent)).toBeLessThan(moved(old));
	});

	it('never lets two points swap sides, so every order survives the shift', () => {
		const xs: number[] = [];
		for (let x = -700; x < 0; x += 0.37) xs.push(x);
		const shifted = xs.map((x) => shiftX(before, after, x));
		for (let i = 1; i < shifted.length; i++) expect(shifted[i]).toBeGreaterThanOrEqual(shifted[i - 1]!);
	});

	it('spreads points standing on one step across the same step on the new scale', () => {
		const time = NOW - 10 * DAY;
		const bottom = timeToX(before, time - 1);
		const top = timeToX(before, time);
		const mid = shiftX(before, after, (bottom + top) / 2);
		expect(mid).toBeGreaterThan(shiftX(before, after, bottom + 0.01 * (top - bottom)));
		expect(mid).toBeLessThan(shiftX(before, after, top - 0.01 * (top - bottom)));
	});

	it('keeps what sits past the edge where it is', () => {
		expect(shiftX(before, after, 0)).toBe(0);
		expect(shiftX(before, after, 37.5)).toBe(37.5);
	});
});
