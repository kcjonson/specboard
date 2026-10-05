import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { Box } from './box-index';
import type { DrawAgent, DrawDot } from './draw-list';
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

/** The whole drawn dot as a box, clear of what it sits next to: its disc or ink ring, and a folded family's rollup bar under it. */
export function dotBox(dot: DrawDot, transform: Transform, level: ZoomLevel): Box {
	const r = screenRadius(dot, transform.k, level) + MARK_REACH + CLEARANCE;
	const { x, y } = screenPoint(transform, dot);
	return { x: x - r, y: y - r, w: 2 * r, h: 2 * r + (dot.folded ? FOLDED_BAR_REACH : 0) };
}

/**
 * A computer or session never draws smaller than this, since its number or its icon has to
 * read at fit all, where a leaf is 2 px, and at the near level both hold one size as glyphs do.
 */
const AGENT_RADIUS = {
	session: { min: 7.5, max: 20, near: 9 },
	computer: { min: 11, max: 28, near: 13 },
} as const;

export function agentRadius(agent: DrawAgent, k: number, level: ZoomLevel): number {
	const { min, max, near } = AGENT_RADIUS[agent.kind];
	return level === 'near' ? near : Math.max(min, Math.min(max, agent.r * k));
}

/** The whole drawn computer or session as a box, clear of what it sits next to. */
export function agentBox(agent: DrawAgent, transform: Transform, level: ZoomLevel): Box {
	const r = agentRadius(agent, transform.k, level) + CLEARANCE + 2;
	const { x, y } = screenPoint(transform, agent);
	return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
}
