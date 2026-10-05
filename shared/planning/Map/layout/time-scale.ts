import { EQUALIZED, HOUR, QUIET_AFTER, QUIET_PAD, TIME_CONSTANT } from './constants';
import type { MapQuiet, MapTick, MapTimeScale } from './types';

const DAY = 24 * HOUR;

/** An empty board (no newest anchor) is never quiet. */
const isQuiet = (newest: number, now: number): boolean => Number.isFinite(newest) && now - newest > QUIET_AFTER;

/** The edge sits at now, unless the board went quiet, when it sits just past the last activity. */
export function edgeOf(newest: number, now: number): number {
	return isQuiet(newest, now) ? newest + QUIET_PAD : now;
}

export function quietOf(newest: number, now: number): MapQuiet | null {
	return isQuiet(newest, now) ? { since: newest, until: now } : null;
}

function logAge(scale: Pick<MapTimeScale, 'edge' | 'tau'>, time: number): number {
	return Math.log(1 + Math.max(0, scale.edge - time) / scale.tau);
}

/**
 * `times` must be ascending. Anything past the edge (clock skew between server and
 * browser, or work since the frame was set) counts as at the edge, so the edge stays at 0.
 */
export function createTimeScale(edge: number, times: number[], unit: number): MapTimeScale {
	const clamped = times.map((time) => Math.min(time, edge));
	const oldest = clamped[0];
	const logSpan = oldest === undefined ? 1 : logAge({ edge, tau: TIME_CONSTANT }, oldest) || 1;
	return { edge, unit, tau: TIME_CONSTANT, equalized: EQUALIZED, times: clamped, logSpan };
}

/** Fraction of the sample before `time`, or at or before it when `inclusive`. */
function cumulative(times: readonly number[], time: number, inclusive: boolean): number {
	let lo = 0;
	let hi = times.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (times[mid]! < time || (inclusive && times[mid] === time)) lo = mid + 1;
		else hi = mid;
	}
	return times.length ? lo / times.length : 1;
}

/**
 * The scale at `time`. The equalized scale steps up at every sampled time; `inclusive`
 * counts the samples at `time` itself, which is the top of the step there, and leaving
 * them out is its bottom.
 */
function xAt(scale: MapTimeScale, time: number, inclusive: boolean): number {
	const equal = (1 - cumulative(scale.times, Math.min(time, scale.edge), inclusive)) * scale.logSpan;
	return -scale.unit * (scale.equalized * equal + (1 - scale.equalized) * logAge(scale, time));
}

/**
 * The blend the spec settles on: equalized (each stretch gets room for how much
 * happened in it) mixed with log of age (recent work gets room).
 */
export function timeToX(scale: MapTimeScale, time: number): number {
	return xAt(scale, time, true);
}

/**
 * The time a point left of the edge stands for: the inverse of timeToX. A point on one of
 * the equalized scale's steps stands for the sampled time there, at `share` of the way up
 * the step; elsewhere the scale is continuous and `share` is null.
 */
function timeAtX(scale: MapTimeScale, x: number): { time: number; share: number | null } {
	const { times, unit, equalized, logSpan, edge, tau } = scale;
	// The last sample whose step starts at or left of x.
	let lo = 0;
	let hi = times.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (xAt(scale, times[mid]!, false) <= x) lo = mid + 1;
		else hi = mid;
	}
	let reached = 0;
	if (lo > 0) {
		const sample = times[lo - 1]!;
		const bottom = xAt(scale, sample, false);
		const top = xAt(scale, sample, true);
		if (x <= top) return { time: sample, share: top > bottom ? (x - bottom) / (top - bottom) : 0 };
		reached = cumulative(times, sample, true);
	}
	// Between steps the equalized part holds still and only the log of age moves.
	const log = (-x / unit - equalized * (1 - reached) * logSpan) / (1 - equalized);
	return { time: edge - tau * Math.expm1(Math.max(0, log)), share: null };
}

/**
 * Where a point on one scale lands on another: the moment it stands for, read on the
 * new scale. A refresh moves the scale (now has moved on, and the anchors it counts have
 * changed), and this is time drift: every point keeps its moment, so the whole Map slides
 * together and no two points ever swap sides, which keeps every order the layout holds.
 * A point on a step keeps its share of that step. Past the edge there are no dates, and
 * what sits there (in-flight work held past now, computers, sessions) keeps its place.
 */
export function shiftX(from: MapTimeScale, to: MapTimeScale, x: number): number {
	if (x >= 0) return x;
	const { time, share } = timeAtX(from, x);
	if (share === null) return timeToX(to, time);
	const bottom = xAt(to, time, false);
	return bottom + share * (xAt(to, time, true) - bottom);
}

/** A tick per day back from the edge to the oldest anchor. */
export function ticksOf(scale: MapTimeScale): MapTick[] {
	const ticks: MapTick[] = [];
	const oldest = scale.times[0] ?? scale.edge;
	for (let time = scale.edge - DAY; time >= oldest; time -= DAY) ticks.push({ time, x: timeToX(scale, time) });
	return ticks;
}
