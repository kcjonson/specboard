/**
 * A dragged dot springs back (spec, decision 10): it overshoots its place a little
 * and settles, in about 300 ms. Nothing is saved.
 */
export const SPRING_MS = 300;

/** A press has to move this far before it is a drag rather than a click. */
export const DRAG_THRESHOLD = 4;

/**
 * How much of the pull is left `t` of the way through the spring, 1 to 0: a damped
 * cosine, which crosses home at about a fifth of the way, swings back past it by a
 * tenth of the pull, and is at rest well before the end.
 */
export function springRemaining(t: number): number {
	if (t <= 0) return 1;
	if (t >= 1) return 0;
	return Math.exp(-5.5 * t) * Math.cos(7.5 * t);
}
