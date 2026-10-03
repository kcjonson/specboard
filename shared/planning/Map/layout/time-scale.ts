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

/** `times` must be ascending. */
export function createTimeScale(edge: number, times: number[], unit: number): MapTimeScale {
	const oldest = times[0];
	const logSpan = oldest === undefined ? 1 : logAge({ edge, tau: TIME_CONSTANT }, oldest) || 1;
	return { edge, unit, tau: TIME_CONSTANT, equalized: EQUALIZED, times, logSpan };
}

/** Fraction of the sample at or before `time`. */
function cumulative(times: readonly number[], time: number): number {
	let lo = 0;
	let hi = times.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (times[mid]! <= time) lo = mid + 1;
		else hi = mid;
	}
	return times.length ? lo / times.length : 1;
}

/**
 * The blend the spec settles on: equalized (each stretch gets room for how much
 * happened in it) mixed with log of age (recent work gets room).
 */
export function timeToX(scale: MapTimeScale, time: number): number {
	const equal = (1 - cumulative(scale.times, time)) * scale.logSpan;
	return -scale.unit * (scale.equalized * equal + (1 - scale.equalized) * logAge(scale, time));
}

/** A tick per day back from the edge to the oldest anchor. */
export function ticksOf(scale: MapTimeScale): MapTick[] {
	const ticks: MapTick[] = [];
	const oldest = scale.times[0] ?? scale.edge;
	for (let time = scale.edge - DAY; time >= oldest; time -= DAY) ticks.push({ time, x: timeToX(scale, time) });
	return ticks;
}
