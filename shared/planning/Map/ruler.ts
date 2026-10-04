import type { Box } from './box-index';
import { HOUR } from './layout/constants';
import type { MapQuiet, MapTick } from './layout/types';

/** Ticks on the ruler are at least this far apart on screen (layout requirement 2). */
export const MIN_TICK_SPACING = 90;

/** Room to the right of the edge the "then quiet" label needs, in pixels. */
export const QUIET_LABEL_ROOM = 120;

/** Tick labels stay this far inside the plot's sides, so a centered label is never cut off. */
const LABEL_MARGIN = 28;

const DAY = 24 * HOUR;

/** The edge's label sits this far in from the edge line, a hair under the plot's top, and flips to the line's left when the right has less than EDGE_LABEL_ROOM. */
const EDGE_LABEL_GAP = 8;
export const EDGE_LABEL_TOP = 10;
const EDGE_LABEL_ROOM = 150;
/** Text height at the label's size, plus the surface halo it draws on. */
const EDGE_LABEL_HEIGHT = 14;
const EDGE_LABEL_HALO = 3;

/**
 * Where the edge's label draws for a line at `x` in a plot `plotWidth` wide: the text's
 * anchor, which side it hangs from, and the box labels elsewhere keep off. Null when the
 * line is outside the plot.
 */
export function edgeLabelAt(x: number, textWidth: number, plotWidth: number): { anchor: number; align: 'left' | 'right'; box: Box } | null {
	if (x < 0 || x > plotWidth) return null;
	const room = plotWidth - x > EDGE_LABEL_ROOM;
	const anchor = room ? x + EDGE_LABEL_GAP : x - EDGE_LABEL_GAP;
	const left = room ? anchor : anchor - textWidth;
	return {
		anchor,
		align: room ? 'left' : 'right',
		box: { x: left - EDGE_LABEL_HALO, y: EDGE_LABEL_TOP - EDGE_LABEL_HALO, w: textWidth + 2 * EDGE_LABEL_HALO, h: EDGE_LABEL_HEIGHT + 2 * EDGE_LABEL_HALO },
	};
}

export interface RulerMark {
	/** Screen x, in CSS pixels. */
	x: number;
	label: string;
}

export interface RulerMarks {
	/** One mark per kept day tick, right to left. Nothing sits right of the edge: past it there are no dates. */
	ticks: RulerMark[];
	/** The line at the edge of the Map, which is now unless the board went quiet. */
	edge: RulerMark;
	/** The labeled break between the last activity and now, when the board has been quiet for half a day or more. */
	quiet: RulerMark | null;
}

export interface RulerInput {
	/** The layout's tick per day back from the edge, right to left. */
	ticks: readonly MapTick[];
	/** Epoch ms at layout x = 0. */
	edge: number;
	quiet: MapQuiet | null;
	/** The horizontal part of the camera: screen x = x + k * layout x. */
	transform: { k: number; x: number };
	/** The plot's width, CSS pixels. */
	width: number;
	timeZone?: string;
}

/** `Sep 30`, with the year once it differs from the edge's. */
export function dayLabel(time: number, edge: number, timeZone?: string): string {
	const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone };
	const year = (t: number): number => Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(t));
	if (year(time) !== year(edge)) options.year = 'numeric';
	return new Intl.DateTimeFormat('en-US', options).format(time);
}

/** "then quiet 6 days", or hours for a break under a day and a half. */
export function quietLabel(quiet: MapQuiet): string {
	const span = quiet.until - quiet.since;
	if (span < 1.5 * DAY) {
		const hours = Math.max(1, Math.round(span / HOUR));
		return `then quiet ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	}
	const days = Math.round(span / DAY);
	return `then quiet ${days} days`;
}

export function rulerMarks(input: RulerInput): RulerMarks {
	const { transform, width } = input;
	const screen = (layoutX: number): number => transform.x + transform.k * layoutX;

	// Thinned across the whole range, then cropped to the plot, so panning never changes
	// which days get a label; only zooming does.
	const ticks: RulerMark[] = [];
	let last = Infinity;
	for (const tick of input.ticks) {
		const x = screen(tick.x);
		if (last - x < MIN_TICK_SPACING) continue;
		last = x;
		if (x < LABEL_MARGIN || x > width - LABEL_MARGIN) continue;
		ticks.push({ x, label: dayLabel(tick.time, input.edge, input.timeZone) });
	}

	const edgeX = screen(0);
	const quiet = input.quiet;
	return {
		ticks,
		edge: { x: edgeX, label: quiet ? `Last activity ${dayLabel(quiet.since, input.edge, input.timeZone)}` : 'Now' },
		quiet: quiet && edgeX >= 0 && width - edgeX >= QUIET_LABEL_ROOM ? { x: edgeX, label: quietLabel(quiet) } : null,
	};
}
