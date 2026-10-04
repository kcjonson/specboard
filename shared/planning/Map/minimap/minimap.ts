import type { Box } from '../box-index';
import type { Transform, Viewport } from '../camera';
import type { MapBounds, MapPoint } from '../layout/types';

/**
 * The minimap (spec, Navigation and interaction): the whole Map in miniature in the
 * plot's lower left once zoomed in, with the viewport marked. The geometry is here,
 * with no DOM, so the corner it reserves and the viewport's rectangle can be tested.
 */

/** The map inside the panel is as big as this allows, in px, keeping the Map's shape. */
export const MINIMAP_MAX_WIDTH = 200;
export const MINIMAP_MAX_HEIGHT = 112;
/** The panel's gap from the plot's left and bottom edges. */
export const MINIMAP_MARGIN = 12;
/** Room between the panel's edge and the miniature. */
export const MINIMAP_PAD = 4;

/** It shows once the camera is this many times past fit all, and hides again below the smaller one. */
export const MINIMAP_ENTER = 1.2;
export const MINIMAP_EXIT = 1.1;

export interface MinimapSize {
	/** The miniature's size in px. */
	width: number;
	height: number;
	/** Pixels per layout unit. */
	scale: number;
}

export function minimapSize(bounds: MapBounds): MinimapSize {
	const w = Math.max(1, bounds.maxX - bounds.minX);
	const h = Math.max(1, bounds.maxY - bounds.minY);
	const scale = Math.min(MINIMAP_MAX_WIDTH / w, MINIMAP_MAX_HEIGHT / h);
	return { width: w * scale, height: h * scale, scale };
}

/** Where the panel sits in the plot, in px from its top left: this is the box labels keep off. */
export function minimapPanel(size: MinimapSize, viewport: Viewport): Box {
	const w = size.width + 2 * MINIMAP_PAD;
	const h = size.height + 2 * MINIMAP_PAD;
	return { x: MINIMAP_MARGIN, y: viewport.height - MINIMAP_MARGIN - h, w, h };
}

/** Shown past fit all, with a gap between showing and hiding so a camera hovering at the edge doesn't flicker it. */
export function minimapShows(k: number, fit: number, shown: boolean): boolean {
	return k >= fit * (shown ? MINIMAP_EXIT : MINIMAP_ENTER);
}

/** A layout point's place in the miniature, in px from the miniature's top left. */
export const toMinimap = (size: MinimapSize, bounds: MapBounds, p: MapPoint): MapPoint => ({
	x: (p.x - bounds.minX) * size.scale,
	y: (p.y - bounds.minY) * size.scale,
});

/** The layout point under a spot in the miniature, held inside the Map. */
export function fromMinimap(size: MinimapSize, bounds: MapBounds, local: MapPoint): MapPoint {
	const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
	return {
		x: clamp(bounds.minX + local.x / size.scale, bounds.minX, bounds.maxX),
		y: clamp(bounds.minY + local.y / size.scale, bounds.minY, bounds.maxY),
	};
}

/** What the plot shows, as a rectangle in the miniature, cut to the miniature: the camera can sit past the Map's edge. */
export function minimapViewport(size: MinimapSize, bounds: MapBounds, transform: Transform, viewport: Viewport): Box {
	const topLeft = toMinimap(size, bounds, { x: -transform.x / transform.k, y: -transform.y / transform.k });
	const bottomRight = toMinimap(size, bounds, { x: (viewport.width - transform.x) / transform.k, y: (viewport.height - transform.y) / transform.k });
	const x0 = Math.max(0, Math.min(size.width, topLeft.x));
	const y0 = Math.max(0, Math.min(size.height, topLeft.y));
	const x1 = Math.max(0, Math.min(size.width, bottomRight.x));
	const y1 = Math.max(0, Math.min(size.height, bottomRight.y));
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
