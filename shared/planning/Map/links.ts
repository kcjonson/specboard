import type { MapPoint } from './layout/types';

/**
 * Every link is one Bezier (spec, Relationships). Chain links and agent lines flow
 * horizontally, the way time runs: a cubic whose ends leave and arrive level.
 * Blocker and discovered-from links arc: a quadratic whose control point stands off
 * the middle by a fifth of the link's length.
 */

/**
 * Chain links, agent lines (a session to each item it is on), and the tie from a computer
 * to its sessions draw at rest (spec, What shows when); the others wait for focus or All links.
 */
export type LinkKind = 'chain' | 'blocker' | 'discovered' | 'agent' | 'machine';

export type LinkCurve =
	| { type: 'cubic'; from: MapPoint; c1: MapPoint; c2: MapPoint; to: MapPoint }
	| { type: 'quadratic'; from: MapPoint; c: MapPoint; to: MapPoint };

const BOW = 0.2;

export function linkCurve(kind: LinkKind, from: MapPoint, to: MapPoint): LinkCurve {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (kind === 'chain' || kind === 'agent' || kind === 'machine') {
		return { type: 'cubic', from, c1: { x: from.x + dx / 2, y: from.y }, c2: { x: to.x - dx / 2, y: to.y }, to };
	}
	return { type: 'quadratic', from, c: { x: (from.x + to.x) / 2 - dy * BOW, y: (from.y + to.y) / 2 + dx * BOW }, to };
}

/** Chain links and the agent layer's lines draw at rest, and every link does while All links is on; the rest wait for focus to light them. */
export const linkAtRest = (kind: LinkKind, all: boolean): boolean => all || kind === 'chain' || kind === 'agent' || kind === 'machine';
