import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { Box } from './box-index';
import type { DrawDot } from './draw-list';
import type { MapPoint } from './layout/types';
import type { ZoomLevel } from './zoom-levels';

/** Labels and dots keep this much clear of each other. */
export const CLEARANCE = 2;
/** A dot's marks reach this far past its radius: the needs-a-person ring at its widest. */
export const MARK_REACH = 3.5;
/** A folded family's rollup bar hangs this far further below its dot. */
export const FOLDED_BAR_REACH = 8;

/**
 * At the near level every glyph is this many px in radius, whatever the zoom or the item's
 * size: a card carries the same glyph (its SVG is 17 px, which is what the
 * canvas makes of the 16-unit glyph box at this radius), and a dot without room for a card is that glyph on
 * its own, so nothing changes size when it gains or loses a card. 8 is also the radius a
 * folded finished family writes its count at.
 */
export const NEAR_GLYPH_RADIUS = 8;

export const screenPoint = (transform: Transform, p: MapPoint): MapPoint => ({ x: transform.x + transform.k * p.x, y: transform.y + transform.k * p.y });

/** A dot's on-screen radius: its layout size at the zoom, until the near level fixes it; never under the minimum the renderer draws. */
export function screenRadius(dot: DrawDot, k: number, level: ZoomLevel): number {
	return level === 'near' ? NEAR_GLYPH_RADIUS : Math.max(dot.r * k, MIN_DRAW_RADIUS);
}

/** A reason tag or an up-next number sits past a dot's ring at its upper right, so its box reaches this much further. */
const MARK_EXTRA = 12;

/** The extra reach of the marks a dot carries at this level: the number at every level, the reason tag once zoomed in. */
export function markExtra(dot: Pick<DrawDot, 'reason' | 'upNext'>, level: ZoomLevel): number {
	return dot.upNext !== null || (dot.reason !== null && level !== 'far') ? MARK_EXTRA : 0;
}

/** How far a dot's marks reach from its center, clear of what it sits next to. */
export function dotReach(dot: DrawDot, k: number, level: ZoomLevel): number {
	return screenRadius(dot, k, level) + MARK_REACH + CLEARANCE + markExtra(dot, level);
}

/** The whole drawn dot as a box, clear of what it sits next to: its disc or ink ring, its marks, and a folded family's rollup bar under it. */
export function dotBox(dot: DrawDot, transform: Transform, level: ZoomLevel): Box {
	const r = dotReach(dot, transform.k, level);
	const { x, y } = screenPoint(transform, dot);
	return { x: x - r, y: y - r, w: 2 * r, h: 2 * r + (dot.folded ? FOLDED_BAR_REACH : 0) };
}
