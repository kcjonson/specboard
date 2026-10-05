import type { MapPoint } from './layout/types';
import { nextStep } from './stepping/stepping';

export type Direction = 'left' | 'right' | 'up' | 'down';

/** Something an arrow key can land on: a drawn dot, or a region's label. */
export interface NavTarget extends MapPoint {
	key: string;
}

/** A target counts as "that way" when it is within 45 degrees of the arrow's axis. */
const CONE = 1;

/** Off-axis offset costs this many times its length, so a dot straight ahead beats a nearer one off to the side. */
const OFF_AXIS_WEIGHT = 2;

const AXES: Record<Direction, MapPoint> = {
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
};

/**
 * The target an arrow key lands on (spec, Keys): the nearest in that direction, where
 * near is the distance along the arrow plus the offset across it, counted double. Targets
 * inside the 45 degree cone are tried first; if the cone is empty the whole half-plane
 * ahead is, so a sparse corner never traps focus, and past the last target in a direction
 * nothing moves (focus stops at the edge, it doesn't wrap, so the person can tell they have
 * reached it). Ties go to the key, so the choice never depends on the order of `targets`.
 */
export function pickInDirection(from: MapPoint, targets: Iterable<NavTarget>, direction: Direction, except: string | null = null): NavTarget | null {
	const axis = AXES[direction];
	let best: NavTarget | null = null;
	let bestScore = Infinity;
	let bestInCone = false;
	for (const target of targets) {
		if (target.key === except) continue;
		const dx = target.x - from.x;
		const dy = target.y - from.y;
		const along = dx * axis.x + dy * axis.y;
		if (along <= 0) continue;
		const across = Math.abs(dx * axis.y - dy * axis.x);
		const inCone = across <= along * CONE;
		if (bestInCone && !inCone) continue;
		const score = Math.hypot(along, across * OFF_AXIS_WEIGHT);
		const better = (inCone && !bestInCone) || score < bestScore || (score === bestScore && best !== null && target.key < best.key);
		if (better) {
			best = target;
			bestScore = score;
			bestInCone = inCone;
		}
	}
	return best;
}

/**
 * The next key in a list after `current`, wrapping at the ends, for P and L: the first
 * (or last, going back) when `current` isn't in the list, and null for an empty list.
 */
export function cycle(list: readonly string[], current: string | null, delta: 1 | -1): string | null {
	const to = nextStep(current === null ? -1 : list.indexOf(current), delta, list.length);
	return to < 0 ? null : list[to]!;
}
