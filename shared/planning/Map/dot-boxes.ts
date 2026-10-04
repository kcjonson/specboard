import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { Box } from './box-index';
import type { DrawDot } from './draw-list';
import type { MapPoint } from './layout/types';

/** Labels and dots keep this much clear of each other. */
export const CLEARANCE = 2;
/** A dot's marks reach this far past its radius: the needs-a-person ring at its widest. */
export const MARK_REACH = 3.5;
/** A folded family's rollup bar hangs this far further below its dot. */
export const FOLDED_BAR_REACH = 8;

export const screenPoint = (transform: Transform, p: MapPoint): MapPoint => ({ x: transform.x + transform.k * p.x, y: transform.y + transform.k * p.y });

/** A dot's on-screen radius, never under the minimum the renderer draws. */
export const screenRadius = (dot: DrawDot, transform: Transform): number => Math.max(dot.r * transform.k, MIN_DRAW_RADIUS);

/** The whole drawn dot as a box, clear of what it sits next to: its disc or ink ring, and a folded family's rollup bar under it. */
export function dotBox(dot: DrawDot, transform: Transform): Box {
	const r = screenRadius(dot, transform) + MARK_REACH + CLEARANCE;
	const { x, y } = screenPoint(transform, dot);
	return { x: x - r, y: y - r, w: 2 * r, h: 2 * r + (dot.folded ? FOLDED_BAR_REACH : 0) };
}
