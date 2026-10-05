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
	/** An up-next region's number, between the glyph and the title. */
	badge: Circle | null;
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
const BADGE_SIZE = 14;
const PAD_RIGHT = 4;
const MAX_TITLE = 180;
/** Candidate spots along an outline are about this far apart on screen, in px. */
const SPOT_STEP = 10;
/** A region tries at most this many spots, so a huge outline at a high zoom stays cheap. */
const MAX_SPOTS = 160;
/** A spot on a steep stretch of the outline counts as this many px lower than it is, so flat edges (the top of a bulb) are tried first. */
const STEEP_PENALTY = 60;

/** A point on an outline, in screen pixels, and how flat the outline runs there: 1 level, 0 upright. */
interface EdgeSpot {
	x: number;
	y: number;
	flat: number;
}

/** An outline's curve as a polyline of its own: each quadratic's middle and its end, in layout units. Computed once per outline. */
const polylines = new WeakMap<RegionOutline, Float64Array>();

function polylineOf(outline: RegionOutline): Float64Array {
	let line = polylines.get(outline);
	if (line) return line;
	const { curve } = outline;
	const quads = (curve.length - 2) / 4;
	line = new Float64Array(2 + quads * 4);
	line[0] = curve[0]!;
	line[1] = curve[1]!;
	let at = 2;
	for (let i = 2; i < curve.length; i += 4) {
		const sx = line[at - 2]!;
		const sy = line[at - 1]!;
		const cx = curve[i]!;
		const cy = curve[i + 1]!;
		const ex = curve[i + 2]!;
		const ey = curve[i + 3]!;
		line[at++] = 0.25 * sx + 0.5 * cx + 0.25 * ex;
		line[at++] = 0.25 * sy + 0.5 * cy + 0.25 * ey;
		line[at++] = ex;
		line[at++] = ey;
	}
	polylines.set(outline, line);
	return line;
}

/**
 * Where a label can sit on an outline, best first: the outline's own top point, then points
 * every few pixels along the whole edge (the top and bottom, both ends, every bulb) that are
 * inside the plot, flat stretches and high ones before steep and low ones. The label's pill
 * is centered on one of these, so it always straddles the outline.
 */
function edgeSpots(outline: RegionOutline, transform: Transform, viewport: Viewport): EdgeSpot[] {
	const line = polylineOf(outline);
	const n = line.length / 2;
	const { k, x: tx, y: ty } = transform;
	const { width, height } = viewport;
	const top = screenPoint(transform, outline.top);
	// Spots outside the plot are dropped, so an outline wholly off it has only its own top to offer.
	const { bounds } = outline;
	if (tx + k * bounds.maxX < 0 || tx + k * bounds.minX > width || ty + k * bounds.maxY < 0 || ty + k * bounds.minY > height) return [{ x: top.x, y: top.y, flat: 1 }];

	// Plain arithmetic over the raw points: a long outline has thousands of them, and there is a pass over each region every frame.
	let length = 0;
	let x0 = tx + k * line[0]!;
	let y0 = ty + k * line[1]!;
	for (let i = 1; i < n; i++) {
		const x1 = tx + k * line[2 * i]!;
		const y1 = ty + k * line[2 * i + 1]!;
		if (x1 >= 0 && x1 <= width && y1 >= 0 && y1 <= height) length += Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
		x0 = x1;
		y0 = y1;
	}
	const step = Math.max(SPOT_STEP, length / MAX_SPOTS);

	const spots: EdgeSpot[] = [];
	let since = step;
	x0 = tx + k * line[0]!;
	y0 = ty + k * line[1]!;
	for (let i = 1; i < n; i++) {
		const x1 = tx + k * line[2 * i]!;
		const y1 = ty + k * line[2 * i + 1]!;
		const segment = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
		since += segment;
		if (since >= step && x1 >= 0 && x1 <= width && y1 >= 0 && y1 <= height) {
			since = 0;
			spots.push({ x: x1, y: y1, flat: segment > 0 ? Math.abs(x1 - x0) / segment : 1 });
		}
		x0 = x1;
		y0 = y1;
	}
	const score = (spot: EdgeSpot): number => spot.y + (1 - spot.flat) * STEEP_PENALTY;
	spots.sort((a, b) => score(a) - score(b));
	return [{ x: top.x, y: top.y, flat: 1 }, ...spots];
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
	const badged = region.upNext !== null;
	const lead = badged ? BADGE_SIZE + GAP : 0;
	const width = PAD_LEFT + GLYPH_SIZE + GAP + lead + titleWidth + GAP + BAR_WIDTH + GAP + TOGGLE_SIZE + PAD_RIGHT;
	const top = y - LABEL_HEIGHT / 2;
	const glyphX = x + PAD_LEFT + GLYPH_SIZE / 2;
	const titleX = x + PAD_LEFT + GLYPH_SIZE + GAP + lead;
	const barX = titleX + titleWidth + GAP;
	return {
		key: region.key,
		region,
		box: { x, y: top, w: width, h: LABEL_HEIGHT },
		glyph: { x: glyphX, y, r: GLYPH_SIZE / 2 },
		badge: badged ? { x: glyphX + GLYPH_SIZE / 2 + GAP + BADGE_SIZE / 2, y, r: BADGE_SIZE / 2 } : null,
		title,
		titleAt: { x: titleX, y },
		bar: { x: barX, y: y - BAR_HEIGHT / 2, w: BAR_WIDTH, h: BAR_HEIGHT },
		segments: rollupSegments(region.rollup, barX, BAR_WIDTH),
		toggle: { x: barX + BAR_WIDTH + GAP + TOGGLE_SIZE / 2, y, r: TOGGLE_SIZE / 2 },
		alpha: 1,
	};
}

/** A label moved by (dx, dy) screen px, every part of it together. */
export function shiftLabel(label: RegionLabel, dx: number, dy: number): RegionLabel {
	const moveCircle = (c: Circle): Circle => ({ ...c, x: c.x + dx, y: c.y + dy });
	return {
		...label,
		box: { ...label.box, x: label.box.x + dx, y: label.box.y + dy },
		glyph: moveCircle(label.glyph),
		badge: label.badge && moveCircle(label.badge),
		titleAt: { x: label.titleAt.x + dx, y: label.titleAt.y + dy },
		bar: { ...label.bar, x: label.bar.x + dx, y: label.bar.y + dy },
		segments: label.segments.map((segment) => ({ ...segment, x: segment.x + dx })),
		toggle: moveCircle(label.toggle),
	};
}

/**
 * While outlines crossfade, a region's label glides from where it stood to where the new
 * outline puts it, on the crossfade's own progress, rather than jumping to the new outline
 * while the old one is still half drawn. `from` holds each label's center in layout units,
 * so a camera that moved meanwhile (a followed dot) carries it along.
 */
export function glideLabels(labels: readonly RegionLabel[], from: ReadonlyMap<string, MapPoint>, transform: Transform, progress: number): RegionLabel[] {
	return labels.map((label) => {
		const was = from.get(label.key);
		if (!was) return label;
		const dx = (transform.x + transform.k * was.x - (label.box.x + label.box.w / 2)) * (1 - progress);
		const dy = (transform.y + transform.k * was.y - (label.box.y + label.box.h / 2)) * (1 - progress);
		return dx === 0 && dy === 0 ? label : shiftLabel(label, dx, dy);
	});
}

/** Each label's center in layout units, for a later glide to start from. */
export function labelCenters(labels: readonly RegionLabel[], transform: Transform): Map<string, MapPoint> {
	return new Map(labels.map((label) => [label.key, { x: (label.box.x + label.box.w / 2 - transform.x) / transform.k, y: (label.box.y + label.box.h / 2 - transform.y) / transform.k }]));
}

export interface RegionPlacement {
	outlines: ReadonlyMap<string, RegionOutline>;
	transform: Transform;
	viewport: Viewport;
	measure(text: string): number;
}

/**
 * The label for one region, at the first spot on its outline that clears `taken` and lies
 * inside the plot; the spot is added to `taken`. Each spot is tried with the pill centered
 * on it, then hanging off it to the right, then to the left. Null when the region has no
 * outline or no room anywhere along it.
 */
export function placeRegionLabel(region: DrawRegion, { outlines, transform, viewport, measure }: RegionPlacement, taken: BoxIndex): RegionLabel | null {
	const outline = outlines.get(region.key);
	if (!outline) return null;
	const fits = (box: Box): boolean => box.x >= 0 && box.y >= 0 && box.x + box.w <= viewport.width && box.y + box.h <= viewport.height && !taken.hits(box);

	const title = fitText(region.title, MAX_TITLE, measure);
	const titleWidth = Math.min(MAX_TITLE, measure(title));
	const width = layoutLabel(region, title, titleWidth, 0, 0).box.w;
	for (const spot of edgeSpots(outline, transform, viewport)) {
		for (const left of [spot.x - width / 2, spot.x, spot.x - width]) {
			// The box alone is enough to try a spot; the label is built once, where it lands.
			const clear = { x: left - CLEARANCE, y: spot.y - LABEL_HEIGHT / 2 - CLEARANCE, w: width + 2 * CLEARANCE, h: LABEL_HEIGHT + 2 * CLEARANCE };
			if (!fits(clear)) continue;
			taken.add(clear);
			return layoutLabel(region, title, titleWidth, left, spot.y);
		}
	}
	return null;
}
