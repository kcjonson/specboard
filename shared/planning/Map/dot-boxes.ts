import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { Box } from './box-index';
import type { DrawDot } from './draw-list';
import { LEAF_RADIUS } from './layout/constants';
import type { MapPoint } from './layout/types';
import type { ZoomLevel } from './zoom-levels';

/** Labels and dots keep this much clear of each other. */
export const CLEARANCE = 2;
/** A dot's marks reach this far past its radius: the needs-a-person ring at its widest. */
export const MARK_REACH = 3.5;
/** A folded family's rollup bar hangs this far further below its dot. */
export const FOLDED_BAR_REACH = 8;

/**
 * At the near level every glyph is this many px in radius for a leaf, whatever the zoom:
 * a card carries the same glyph at that size, and a dot without room for a card is the
 * same glyph on its own. Bigger items (in flight, a folded family) scale up to 1.5x.
 */
export const NEAR_GLYPH_RADIUS = 8;
const NEAR_GLYPH_MAX_SCALE = 1.5;

export const screenPoint = (transform: Transform, p: MapPoint): MapPoint => ({ x: transform.x + transform.k * p.x, y: transform.y + transform.k * p.y });

/** A dot's on-screen radius: its layout size at the zoom, until the near level fixes it; never under the minimum the renderer draws. */
export function screenRadius(dot: DrawDot, k: number, level: ZoomLevel): number {
	if (level === 'near') return NEAR_GLYPH_RADIUS * Math.min(NEAR_GLYPH_MAX_SCALE, Math.max(1, dot.r / LEAF_RADIUS));
	return Math.max(dot.r * k, MIN_DRAW_RADIUS);
}

/** The whole drawn dot as a box, clear of what it sits next to: its disc or ink ring, and a folded family's rollup bar under it. */
export function dotBox(dot: DrawDot, transform: Transform, level: ZoomLevel): Box {
	const r = screenRadius(dot, transform.k, level) + MARK_REACH + CLEARANCE;
	const { x, y } = screenPoint(transform, dot);
	return { x: x - r, y: y - r, w: 2 * r, h: 2 * r + (dot.folded ? FOLDED_BAR_REACH : 0) };
}
