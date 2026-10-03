import { MIN_DRAW_RADIUS, type Transform, type Viewport } from './camera';
import type { DrawDot, DrawRegion, Rollup } from './draw-list';
import type { MapPhase, MapPoint } from './layout/types';
import type { RegionOutline } from './regions/outline';

/**
 * Where region labels go (spec, Regions): on the outline, at the top where there's
 * room, never over a dot or another label; no room, no label. A label is a pill that
 * straddles the outline: the parent's status glyph, its title, a rollup bar split by
 * phase, and the collapse control. Placement is in screen pixels, redone per frame,
 * which is cheap next to the outlines it sits on.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

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
/** Labels and dots keep this much clear of each other. */
const CLEARANCE = 2;
/** How far either side of a point on the outline counts as the outline there, in layout units. */
const EDGE_REACH = 6;

/** Label centers tried along the top edge, in label widths from the top point. */
const SHIFTS = [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1, -1.5, 1.5, -2, 2];

/** The outline's highest (or lowest) on-curve point within a few units of `x`, in layout units; null where the outline doesn't reach. */
function edgeAt(outline: RegionOutline, x: number, side: 'top' | 'bottom'): number | null {
	const { curve } = outline;
	let best: number | null = null;
	for (let i = 4; i < curve.length; i += 4) {
		if (Math.abs(curve[i]! - x) > EDGE_REACH) continue;
		const y = curve[i + 1]!;
		if (best === null || (side === 'top' ? y < best : y > best)) best = y;
	}
	return best;
}

/** At rest at fit all, only the largest regions get labels (spec, What shows when). */
export const REST_LABELS = 8;

/** The phases in the order the bar shows them. */
const PHASES: readonly MapPhase[] = ['done', 'in_flight', 'next', 'later'];

/** Cut to `max` pixels with an ellipsis, measured by the caller's font. */
export function fitText(text: string, max: number, measure: (text: string) => number): string {
	if (measure(text) <= max) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const middle = Math.ceil((lo + hi) / 2);
		if (measure(`${text.slice(0, middle).trimEnd()}…`) <= max) lo = middle;
		else hi = middle - 1;
	}
	return `${text.slice(0, lo).trimEnd()}…`;
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

const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

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
	};
}

export interface LabelPlacement {
	regions: readonly DrawRegion[];
	outlines: ReadonlyMap<string, RegionOutline>;
	dots: readonly DrawDot[];
	transform: Transform;
	viewport: Viewport;
	measure(text: string): number;
	/** At most this many labels, null for every one with room. */
	cap: number | null;
}

/** Labels for the regions with room, largest regions first. */
export function placeRegionLabels({ regions, outlines, dots, transform, viewport, measure, cap }: LabelPlacement): RegionLabel[] {
	const { k } = transform;
	const screen = (p: MapPoint): MapPoint => ({ x: transform.x + k * p.x, y: transform.y + k * p.y });
	const taken: Box[] = [];
	for (const dot of dots) {
		const r = Math.max(dot.r * k, MIN_DRAW_RADIUS) + CLEARANCE;
		const { x, y } = screen(dot);
		if (x + r < 0 || x - r > viewport.width || y + r < 0 || y - r > viewport.height) continue;
		taken.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
	}
	const fits = (box: Box): boolean =>
		box.x >= 0 && box.y >= 0 && box.x + box.w <= viewport.width && box.y + box.h <= viewport.height && !taken.some((other) => intersects(box, other));

	const labels: RegionLabel[] = [];
	const ordered = [...regions].sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	for (const region of ordered) {
		if (cap !== null && labels.length >= cap) break;
		const outline = outlines.get(region.key);
		if (!outline) continue;
		const title = fitText(region.title, MAX_TITLE, measure);
		const titleWidth = Math.min(MAX_TITLE, measure(title));
		const width = layoutLabel(region, title, titleWidth, 0, 0).box.w;
		const top = screen(outline.top);
		const bottom = screen(outline.bottom);
		// Centered on the top, then along the top edge either way, then the same along the bottom.
		const candidates: MapPoint[] = [];
		for (const [side, from] of [['top', top], ['bottom', bottom]] as const) {
			for (const shift of SHIFTS) {
				const x = from.x + shift * width;
				const y = edgeAt(outline, (x - transform.x) / k, side);
				if (y !== null) candidates.push({ x: x - width / 2, y: transform.y + k * y });
			}
		}
		for (const at of candidates) {
			const label = layoutLabel(region, title, titleWidth, at.x, at.y);
			const clear = { x: label.box.x - CLEARANCE, y: label.box.y - CLEARANCE, w: label.box.w + 2 * CLEARANCE, h: label.box.h + 2 * CLEARANCE };
			if (!fits(clear)) continue;
			taken.push(clear);
			labels.push(label);
			break;
		}
	}
	return labels;
}
