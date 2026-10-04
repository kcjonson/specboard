import { LEAF_RADIUS } from './layout/constants';
import type { MapBounds, MapPoint } from './layout/types';

/**
 * Camera math, with no DOM in it. A transform maps layout units to screen pixels:
 * `screen = (x + k * world.x, y + k * world.y)`, the same convention d3-zoom uses, so
 * the controller can hand these straight to it.
 */

/** What the camera needs of a dot: where it is and how big. */
export interface Dot extends MapPoint {
	key: string;
	r: number;
}

export interface Transform {
	k: number;
	x: number;
	y: number;
}

/** The plot's size in CSS pixels: the canvas without the ruler band under it. */
export interface Viewport {
	width: number;
	height: number;
}

/**
 * "Readable" for the default viewport (spec decision 11): the smallest dot, a leaf
 * of LEAF_RADIUS layout units, is at least this many pixels in radius. At 4 px a dot
 * is 8 px across, which is about the least that still tells a ring from a half-full
 * disc from a check.
 */
export const READABLE_DOT_RADIUS = 4;

/** Dots never draw smaller than this on screen, so a big board at fit all stays visible. */
export const MIN_DRAW_RADIUS = 2;

/** Space kept clear around the Map at fit all, in pixels. */
export const FIT_PADDING = 24;

/** The toolbar sits over the plot's top left, so fit all starts below it. */
export const FIT_TOP_PADDING = 64;

export const MAX_SCALE = 8;

/** Now zooms in to at least this multiple of fit all (the prototype's value). */
export const NOW_ZOOM = 2.4;

/** Steps of the on-screen zoom buttons. */
export const ZOOM_STEP = 1.4;

export const readableScale = (): number => READABLE_DOT_RADIUS / LEAF_RADIUS;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function fitScale(bounds: MapBounds, viewport: Viewport): number {
	const width = Math.max(1, bounds.maxX - bounds.minX);
	const height = Math.max(1, bounds.maxY - bounds.minY);
	const k = Math.min((viewport.width - 2 * FIT_PADDING) / width, (viewport.height - FIT_TOP_PADDING - FIT_PADDING) / height);
	return Math.max(k, 0.01);
}

/** Scales the Map to fit and centers it in the plot below the toolbar. */
export function fitTransform(bounds: MapBounds, viewport: Viewport): Transform {
	const k = fitScale(bounds, viewport);
	const middle = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
	return { k, x: viewport.width / 2 - k * middle.x, y: (FIT_TOP_PADDING + viewport.height - FIT_PADDING) / 2 - k * middle.y };
}

/** The view that puts a layout point in the middle of the plot. */
export function centeredOn(point: MapPoint, k: number, viewport: Viewport): Transform {
	return { k, x: viewport.width / 2 - k * point.x, y: viewport.height / 2 - k * point.y };
}

/** The layout point under the middle of the plot. */
export function centerOf(transform: Transform, viewport: Viewport): MapPoint {
	return { x: (viewport.width / 2 - transform.x) / transform.k, y: (viewport.height / 2 - transform.y) / transform.k };
}

/**
 * The most recent stretch at scale `k`: the right edge of the Map (now, and the strip
 * of in-flight work and computers past it) against the right edge of the plot, centered
 * vertically on whatever dots that stretch holds.
 */
export function recentTransform(bounds: MapBounds, dots: readonly Dot[], k: number, viewport: Viewport): Transform {
	const x = viewport.width - FIT_PADDING - k * bounds.maxX;
	const leftmost = bounds.maxX - (viewport.width - 2 * FIT_PADDING) / k;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const dot of dots) {
		if (dot.x + dot.r < leftmost) continue;
		minY = Math.min(minY, dot.y - dot.r);
		maxY = Math.max(maxY, dot.y + dot.r);
	}
	const middle = Number.isFinite(minY) ? (minY + maxY) / 2 : (bounds.minY + bounds.maxY) / 2;
	return { k, x, y: viewport.height / 2 - k * middle };
}

/**
 * Decision 11: now at the right edge, at fit all when the whole Map fits at a readable
 * scale, otherwise at the readable scale on the most recent stretch.
 */
export function openTransform(bounds: MapBounds, dots: readonly Dot[], viewport: Viewport): Transform {
	const fit = fitScale(bounds, viewport);
	if (fit >= readableScale()) return fitTransform(bounds, viewport);
	return recentTransform(bounds, dots, readableScale(), viewport);
}

/** In a good deal closer than the opening view, for jumps that want to show one place. */
function closeScale(bounds: MapBounds, dots: readonly Dot[], viewport: Viewport): number {
	return Math.min(MAX_SCALE, Math.max(openTransform(bounds, dots, viewport).k, NOW_ZOOM * fitScale(bounds, viewport)));
}

/** The Now button: the right edge, in closer than the opening view when that one shows everything. */
export function nowTransform(bounds: MapBounds, dots: readonly Dot[], viewport: Viewport): Transform {
	return recentTransform(bounds, dots, closeScale(bounds, dots, viewport), viewport);
}

/** The target of a jump to an item: it sits in the middle of the plot, at the close scale or the current one if that is closer in. */
export function focusTransform(point: MapPoint, bounds: MapBounds, dots: readonly Dot[], current: Transform | null, viewport: Viewport): Transform {
	return centeredOn(point, Math.min(MAX_SCALE, Math.max(closeScale(bounds, dots, viewport), current?.k ?? 0)), viewport);
}

/**
 * Keeps the Map from being panned away entirely: the layout point under the middle of the plot stays inside the Map's bounds.
 */
export function constrainTransform(transform: Transform, bounds: MapBounds, viewport: Viewport): Transform {
	const center = centerOf(transform, viewport);
	const x = clamp(center.x, bounds.minX, bounds.maxX);
	const y = clamp(center.y, bounds.minY, bounds.maxY);
	return centeredOn({ x, y }, transform.k, viewport);
}

/** Whether any dot is in the plot, by the radius it is drawn at (`radiusOf`), which depends on the zoom level. */
export function dotsVisible<T extends Dot>(dots: readonly T[], transform: Transform, viewport: Viewport, radiusOf: (dot: T) => number): boolean {
	for (const dot of dots) {
		const r = radiusOf(dot);
		const x = transform.x + transform.k * dot.x;
		const y = transform.y + transform.k * dot.y;
		if (x + r > 0 && x - r < viewport.width && y + r > 0 && y - r < viewport.height) return true;
	}
	return false;
}

/** The dot whose center is nearest a layout point, or undefined on an empty Map. */
export function nearestDot(dots: readonly Dot[], point: MapPoint): Dot | undefined {
	let best: Dot | undefined;
	let bestDistance = Infinity;
	for (const dot of dots) {
		const distance = (dot.x - point.x) ** 2 + (dot.y - point.y) ** 2;
		if (distance < bestDistance) {
			best = dot;
			bestDistance = distance;
		}
	}
	return best;
}

/** A cubic Bezier easing (CSS `cubic-bezier(x1, y1, x2, y2)`), solved by bisection on x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const axis = (a: number, b: number, s: number): number => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
	return (t) => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 24; i++) {
			const mid = (lo + hi) / 2;
			if (axis(x1, x2, mid) < t) lo = mid;
			else hi = mid;
		}
		return axis(y1, y2, (lo + hi) / 2);
	};
}
