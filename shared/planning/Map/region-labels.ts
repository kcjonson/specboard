import { BoxIndex, type Box } from './box-index';
import type { Transform, Viewport } from './camera';
import { CLEARANCE, screenPoint } from './dot-boxes';
import type { DrawRegion, Rollup } from './draw-list';
import type { MapPhase, MapPoint } from './layout/types';
import type { RegionOutline } from './regions/outline';

/**
 * Where region labels go (spec, Regions): on the outline, at the top where there's
 * room, never over a dot or another label; no room, no label. A label is a pill that
 * straddles the outline: the parent's status glyph, its title, a rollup bar split by
 * phase, and the collapse control. Placement is in screen pixels, redone per frame,
 * which is cheap next to the outlines it sits on.
 */

export interface Circle {
	x: number;
	y: number;
	r: number;
}

export interface RollupSegment {
	phase: MapPhase;
	x: number;
	w: number;
}

export interface RegionLabel {
	key: string;
	region: DrawRegion;
	box: Box;
	glyph: Circle;
	title: string;
	/** Left end of the title, on the box's vertical middle. */
	titleAt: MapPoint;
	bar: Box;
	segments: RollupSegment[];
	/** The collapse control. */
	toggle: Circle;
	/** 1 at rest; below 1 while the label fades with a level switch. */
	alpha: number;
}

export const LABEL_HEIGHT = 18;
const PAD_LEFT = 6;
const GLYPH_SIZE = 10;
const GAP = 6;
export const BAR_WIDTH = 32;
export const BAR_HEIGHT = 4;
const TOGGLE_SIZE = 12;
const PAD_RIGHT = 4;
const MAX_TITLE = 180;
/** Points sampled along each of the outline's curves when finding its edge. */
const CURVE_SAMPLES = 4;
/** How far either side of a point on the outline counts as the outline there, in layout units. */
const EDGE_REACH = 6;

/** Label centers tried along the top edge, in label widths from the top point. */
const SHIFTS = [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1, -1.5, 1.5, -2, 2];

/**
 * The outline's highest (or lowest) point within a few units of `x`, in layout units;
 * null where the outline doesn't reach. Each quadratic is sampled along its length, not
 * just at its ends, since its control point can carry the curve past both.
 */
function edgeAt(outline: RegionOutline, x: number, side: 'top' | 'bottom'): number | null {
	const { curve } = outline;
	let best: number | null = null;
	for (let i = 2; i < curve.length; i += 4) {
		const sx = curve[i - 2]!;
		const sy = curve[i - 1]!;
		const cx = curve[i]!;
		const cy = curve[i + 1]!;
		const ex = curve[i + 2]!;
		const ey = curve[i + 3]!;
		for (let s = 0; s <= CURVE_SAMPLES; s++) {
			const t = s / CURVE_SAMPLES;
			const u = 1 - t;
			const px = u * u * sx + 2 * u * t * cx + t * t * ex;
			if (Math.abs(px - x) > EDGE_REACH) continue;
			const py = u * u * sy + 2 * u * t * cy + t * t * ey;
			if (best === null || (side === 'top' ? py < best : py > best)) best = py;
		}
	}
	return best;
}

/** The phases in the order the bar shows them. */
const PHASES: readonly MapPhase[] = ['done', 'in_flight', 'next', 'later'];

/** Cut to `max` pixels with an ellipsis, measured by the caller's font. */
export function fitText(text: string, max: number, measure: (text: string) => number): string {
	if (measure(text) <= max) return text;
	// By code point, so a cut never splits a surrogate pair.
	const chars = Array.from(text);
	const cut = (n: number): string => `${chars.slice(0, n).join('').trimEnd()}…`;
	let lo = 0;
	let hi = chars.length;
	while (lo < hi) {
		const middle = Math.ceil((lo + hi) / 2);
		if (measure(cut(middle)) <= max) lo = middle;
		else hi = middle - 1;
	}
	return cut(lo);
}

/** A bar of `width` split by phase, every phase present at least 2 px so a lone item still shows. */
export function rollupSegments(rollup: Rollup, x: number, width: number): RollupSegment[] {
	const total = PHASES.reduce((sum, phase) => sum + rollup[phase], 0);
	if (!total) return [];
	const present = PHASES.filter((phase) => rollup[phase] > 0);
	const minimum = 2;
	const spare = width - minimum * present.length;
	const segments: RollupSegment[] = [];
	let at = x;
	present.forEach((phase, i) => {
		const w = i === present.length - 1 ? x + width - at : minimum + Math.max(0, (spare * rollup[phase]) / total);
		segments.push({ phase, x: at, w });
		at += w;
	});
	return segments;
}

/** One region's label laid out with its box's left edge at `x` and its middle at `y`. */
function layoutLabel(region: DrawRegion, title: string, titleWidth: number, x: number, y: number): RegionLabel {
	const width = PAD_LEFT + GLYPH_SIZE + GAP + titleWidth + GAP + BAR_WIDTH + GAP + TOGGLE_SIZE + PAD_RIGHT;
	const top = y - LABEL_HEIGHT / 2;
	const glyphX = x + PAD_LEFT + GLYPH_SIZE / 2;
	const titleX = x + PAD_LEFT + GLYPH_SIZE + GAP;
	const barX = titleX + titleWidth + GAP;
	return {
		key: region.key,
		region,
		box: { x, y: top, w: width, h: LABEL_HEIGHT },
		glyph: { x: glyphX, y, r: GLYPH_SIZE / 2 },
		title,
		titleAt: { x: titleX, y },
		bar: { x: barX, y: y - BAR_HEIGHT / 2, w: BAR_WIDTH, h: BAR_HEIGHT },
		segments: rollupSegments(region.rollup, barX, BAR_WIDTH),
		toggle: { x: barX + BAR_WIDTH + GAP + TOGGLE_SIZE / 2, y, r: TOGGLE_SIZE / 2 },
		alpha: 1,
	};
}

export interface RegionPlacement {
	outlines: ReadonlyMap<string, RegionOutline>;
	transform: Transform;
	viewport: Viewport;
	measure(text: string): number;
}

/**
 * The label for one region, at the first spot that clears `taken` and lies inside the
 * plot; the spot is added to `taken`. Null when the region has no outline or no room.
 */
export function placeRegionLabel(region: DrawRegion, { outlines, transform, viewport, measure }: RegionPlacement, taken: BoxIndex): RegionLabel | null {
	const { k } = transform;
	const outline = outlines.get(region.key);
	if (!outline) return null;
	const fits = (box: Box): boolean => box.x >= 0 && box.y >= 0 && box.x + box.w <= viewport.width && box.y + box.h <= viewport.height && !taken.hits(box);

	const title = fitText(region.title, MAX_TITLE, measure);
	const titleWidth = Math.min(MAX_TITLE, measure(title));
	const width = layoutLabel(region, title, titleWidth, 0, 0).box.w;
	const top = screenPoint(transform, outline.top);
	const bottom = screenPoint(transform, outline.bottom);
	// Centered on the top, then along the top edge either way, then the same along the bottom.
	for (const [side, from] of [['top', top], ['bottom', bottom]] as const) {
		for (const shift of SHIFTS) {
			const x = from.x + shift * width;
			const y = edgeAt(outline, (x - transform.x) / k, side);
			if (y === null) continue;
			const label = layoutLabel(region, title, titleWidth, x - width / 2, transform.y + k * y);
			const clear = { x: label.box.x - CLEARANCE, y: label.box.y - CLEARANCE, w: label.box.w + 2 * CLEARANCE, h: label.box.h + 2 * CLEARANCE };
			if (!fits(clear)) continue;
			taken.add(clear);
			return label;
		}
	}
	return null;
}
