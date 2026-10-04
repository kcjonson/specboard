import { BoxIndex, type Box } from './box-index';
import { CLEARANCE, FOLDED_BAR_REACH, MARK_REACH, screenPoint, screenRadius } from './dot-boxes';
import type { Transform, Viewport } from './camera';
import type { DrawDot } from './draw-list';
import type { ZoomLevel } from './zoom-levels';

/**
 * Key and short title beside a dot (spec, What shows when). The label goes where
 * nothing else is: the first of a ring of spots around the dot that clears every drawn
 * dot, region pill, and reserved box, and no spot, no label. Placement is in screen
 * pixels with the canvas's own text metrics, redone per frame.
 */

/** The fonts the Map's canvas text uses; the renderer owns what each one is. */
export type LabelFont = 'region' | 'dot' | 'dot-strong';

export interface DotLabel {
	key: string;
	/** Key and title, already cut to fit. */
	text: string;
	box: Box;
	/** In-flight work reads in full ink and heavier; the rest is muted. */
	strong: boolean;
	/** 1 at rest; below 1 while the label fades with a level switch. */
	alpha: number;
}

export const DOT_LABEL_HEIGHT = 14;
/** Room either side of the text inside the label's box. */
export const DOT_LABEL_PAD = 2;
/** The text is cut to this many pixels. */
export const MAX_DOT_LABEL = 150;

/** Where a label of this size can sit around a dot at (x, y) whose box reaches `reach` px, in the order they are tried. */
function spots(x: number, y: number, reach: number, below: number, w: number, h: number): Array<{ x: number; y: number }> {
	const c = CLEARANCE;
	const right = x + reach + c;
	const left = x - reach - c - w;
	return [
		{ x: right, y: y - h / 2 },
		{ x: left, y: y - h / 2 },
		{ x: x - w / 2, y: y - reach - c - h },
		{ x: x - w / 2, y: y + reach + c + below },
		{ x: right, y: y - h * 1.5 },
		{ x: right, y: y + h / 2 },
		{ x: left, y: y - h * 1.5 },
		{ x: left, y: y + h / 2 },
	];
}

/**
 * Places one dot's label against what is already taken, adds it to `taken`, and
 * returns its box; null when no spot is clear. A label stays whole inside the plot, so
 * one beside a dot at the edge goes to the side that has room, not under the edge.
 */
export function placeDotLabel(dot: DrawDot, textWidth: number, transform: Transform, level: ZoomLevel, viewport: Viewport, taken: BoxIndex): Box | null {
	const w = textWidth + 2 * DOT_LABEL_PAD;
	const h = DOT_LABEL_HEIGHT;
	const { x, y } = screenPoint(transform, dot);
	const reach = screenRadius(dot, transform.k, level) + MARK_REACH + CLEARANCE;
	for (const spot of spots(x, y, reach, dot.folded ? FOLDED_BAR_REACH : 0, w, h)) {
		const box = { x: spot.x, y: spot.y, w, h };
		if (box.x < 0 || box.y < 0 || box.x + w > viewport.width || box.y + h > viewport.height) continue;
		const clear = { x: box.x - CLEARANCE, y: box.y - CLEARANCE, w: box.w + 2 * CLEARANCE, h: box.h + 2 * CLEARANCE };
		if (taken.hits(clear)) continue;
		taken.add(clear);
		return box;
	}
	return null;
}
