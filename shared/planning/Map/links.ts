import type { MapPoint } from './layout/types';

/**
 * Every link is one Bezier (spec, Relationships). Chain links and agent lines flow
 * horizontally, the way time runs: a cubic whose ends leave and arrive level.
 * Blocker and discovered-from links arc: a quadratic whose control point stands off
 * the middle by a fifth of the link's length.
 */

/** Chain links draw at rest; the others wait for focus or All links. */
export type LinkKind = 'chain' | 'blocker' | 'discovered' | 'agent';

export type LinkCurve =
	| { type: 'cubic'; from: MapPoint; c1: MapPoint; c2: MapPoint; to: MapPoint }
	| { type: 'quadratic'; from: MapPoint; c: MapPoint; to: MapPoint };

const BOW = 0.2;

export function linkCurve(kind: LinkKind, from: MapPoint, to: MapPoint): LinkCurve {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (kind === 'chain' || kind === 'agent') {
		return { type: 'cubic', from, c1: { x: from.x + dx / 2, y: from.y }, c2: { x: to.x - dx / 2, y: to.y }, to };
	}
	return { type: 'quadratic', from, c: { x: (from.x + to.x) / 2 - dy * BOW, y: (from.y + to.y) / 2 + dx * BOW }, to };
}

/**
 * Which links show besides chains: every one while All links is on, otherwise the
 * ones lit by focus or selection, by link id. Null lights nothing.
 */
export interface LinkLighting {
	all: boolean;
	lit: ReadonlySet<string> | null;
}

export const NO_LIGHTING: LinkLighting = { all: false, lit: null };

export const linkShows = (kind: LinkKind, id: string, lighting: LinkLighting): boolean =>
	kind === 'chain' || kind === 'agent' || lighting.all || (lighting.lit?.has(id) ?? false);
