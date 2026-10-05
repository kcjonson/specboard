import { BoxIndex, intersects, type Box } from './box-index';
import type { Transform, Viewport } from './camera';
import { CARD_GAP, cardBox, visibleCards } from './cards/card-culling';
import { CLEARANCE, dotBox } from './dot-boxes';
import { MAX_DOT_LABEL, placeDotLabel, type DotLabel, type LabelFont } from './dot-labels';
import type { DrawDot, DrawRegion } from './draw-list';
import { fitText, placeRegionLabel, type Circle, type RegionLabel } from './region-labels';
import type { Highlight } from './map-lens';
import type { RegionOutline } from './regions/outline';
import type { LabelRules, ZoomLevel } from './zoom-levels';

/**
 * Every label at one level, in one pass against one set of taken boxes, so nothing
 * lands over a dot, another label, or something a later layer reserved (spec, What
 * shows when). The order is the priority: in-progress dots, regions, in-review dots,
 * then every other dot with room. The first to ask gets the spot.
 */

/** Dots farther past the plot's edge than a label is wide can't reach into it. */
const EDGE_MARGIN = MAX_DOT_LABEL + 16;

export interface LabelInput {
	rules: LabelRules;
	level: ZoomLevel;
	regions: readonly DrawRegion[];
	outlines: ReadonlyMap<string, RegionOutline>;
	dots: readonly DrawDot[];
	transform: Transform;
	viewport: Viewport;
	/** A string's width in px at a label font, from the canvas's own metrics. */
	measure(text: string, font: LabelFont): number;
	/** Items another layer already names (a computer's block, say), so they get no label of their own. */
	named: ReadonlySet<string>;
	/**
	 * What a search or filter lights: those dots, and the regions whose own parent matches, get labels at any
	 * level. The changes view also names its most recent changes (`recent`) first, and then gives families
	 * no labels at rest, as it is the changes the Map is about.
	 */
	lit?: Pick<Highlight, 'dots' | 'outlined' | 'recent'>;
	/** Screen marks a label or card keeps off: expand controls, and boxes reserved outright such as the toolbar's and the minimap's. */
	occupied: { circles: readonly Circle[]; boxes: readonly Box[] };
}

export interface PlacedLabels {
	regions: RegionLabel[];
	dots: DotLabel[];
	/** The dots that carry a full card, in the order they were placed. */
	cards: DrawDot[];
}

const byKey = (a: DrawDot, b: DrawDot): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** In-progress work gets its card first, then review, then what needs a person, then the rest. */
const cardRank = (dot: DrawDot): number => (dot.flight === 'in_progress' ? 0 : dot.flight === 'in_review' ? 1 : dot.reason !== null ? 2 : 3);

const inflate = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by });

const NO_LIT: NonNullable<LabelInput['lit']> = { dots: new Set(), outlined: new Set(), recent: undefined };

export function placeLabels({ rules, level, regions, outlines, dots, transform, viewport, measure, named, occupied, lit = NO_LIT }: LabelInput): PlacedLabels {
	const taken = new BoxIndex();
	const near: DrawDot[] = [];
	for (const dot of dots) {
		const box = dotBox(dot, transform, level);
		if (box.x + box.w < -EDGE_MARGIN || box.x > viewport.width + EDGE_MARGIN || box.y + box.h < -EDGE_MARGIN || box.y > viewport.height + EDGE_MARGIN) continue;
		taken.add(box, dot.key);
		near.push(dot);
	}
	for (const { x, y, r } of occupied.circles) taken.add({ x: x - r - CLEARANCE, y: y - r - CLEARANCE, w: 2 * (r + CLEARANCE), h: 2 * (r + CLEARANCE) });
	for (const box of occupied.boxes) taken.add(box);

	const placed: PlacedLabels = { regions: [], dots: [], cards: [] };

	// Cards first: a card is the biggest thing on the plot, and it says everything a label would. One that has no room
	// is not squeezed in; its dot stays a glyph and gets a one-line label below, if there is room for that.
	if (rules.cards) {
		// A family folded into a dot that can be opened keeps its glyph and its plus: a card would cover the control, and cards aren't operable yet.
		const candidates = new Set(visibleCards(near.filter((dot) => !dot.folded?.expandable), transform, viewport).map((dot) => dot.key));
		const ordered = near.filter((dot) => candidates.has(dot.key)).sort((a, b) => cardRank(a) - cardRank(b) || b.r - a.r || byKey(a, b));
		for (const dot of ordered) {
			const clear = inflate(cardBox(dot, transform), CARD_GAP / 2);
			if (taken.hits(clear, dot.key)) continue;
			taken.add(clear);
			placed.cards.push(dot);
		}
	}
	const carded = new Set(placed.cards.map((dot) => dot.key));

	const labelDots = (candidates: readonly DrawDot[]): void => {
		for (const dot of candidates) {
			const strong = dot.flight !== null || lit.dots.has(dot.key);
			const font: LabelFont = strong ? 'dot-strong' : 'dot';
			const text = fitText(`${dot.key} ${dot.title}`, MAX_DOT_LABEL, (t) => measure(t, font));
			const box = placeDotLabel(dot, Math.min(MAX_DOT_LABEL, measure(text, font)), transform, level, viewport, taken);
			if (box) placed.dots.push({ key: dot.key, text, box, strong, alpha: 1 });
		}
	};

	// What is named ahead of the regions: every dot the lens lit, or only the most recent changes when the changes view is open.
	const first = lit.recent ?? lit.dots;
	const unnamed = near.filter((dot) => !named.has(dot.key) && !carded.has(dot.key));
	if (rules.dots !== 'none') labelDots(unnamed.filter((dot) => dot.flight === 'in_progress').sort(byKey));
	// Matches are what the person asked to see: they are named before the regions take the room around them, at any level.
	const matches = unnamed.filter((dot) => first.has(dot.key) && !(rules.dots !== 'none' && dot.flight === 'in_progress'));
	labelDots(matches.sort((a, b) => b.r - a.r || byKey(a, b)));

	const regionPlacement = { outlines, transform, viewport, measure: (text: string) => measure(text, 'region') };
	const ordered = [...regions].sort((a, b) => Number(lit.outlined.has(b.key)) - Number(lit.outlined.has(a.key)) || b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	for (const region of ordered) {
		if (rules.regions !== null && !lit.outlined.has(region.key) && (lit.recent || placed.regions.length >= rules.regions)) continue;
		const label = placeRegionLabel(region, regionPlacement, taken);
		if (label) placed.regions.push(label);
	}

	// After the regions: a region's label is what names a whole cluster, and a crowd of in-review labels would take every spot on its outline.
	// With the changes view open, only changed dots are named at rest: the rest are dimmed, and a label would pull the eye back to them.
	const namedAtRest = (dot: DrawDot): boolean => !lit.recent || lit.dots.has(dot.key);
	if (rules.dots !== 'none') labelDots(unnamed.filter((dot) => dot.flight === 'in_review' && !first.has(dot.key) && namedAtRest(dot)).sort(byKey));
	if (rules.dots === 'all') {
		// Bigger dots first: they are the ones that matter, and the same dots win every frame.
		labelDots(unnamed.filter((dot) => dot.flight === null && !first.has(dot.key)).sort((a, b) => b.r - a.r || byKey(a, b)));
	}
	return placed;
}

/** Where the cards are on each side of a level switch, in screen pixels: those the new level draws and those the old one did. */
export interface FadingCards {
	arriving: readonly Box[];
	leaving: readonly Box[];
}

/**
 * The labels mid-fade between two levels, both kinds together; see `crossFade`. The two
 * levels were placed apart, so what fades can land on something that doesn't:
 * - a label that is leaving where a label or card is arriving goes at once, rather than draw under it;
 * - a label that is arriving where a card is leaving waits until that card is mostly gone.
 */
export function crossFadeAll(next: PlacedLabels, previous: PlacedLabels, progress: number, cards: FadingCards = { arriving: [], leaving: [] }): PlacedLabels {
	const regions = crossFade(next.regions, previous.regions, progress);
	const dots = crossFade(next.dots, previous.dots, progress);
	const arriving = [...next.regions, ...next.dots].map((label) => label.box).concat(cards.arriving);
	const stillRegions = new Set(next.regions.map((label) => label.key));
	const stillDots = new Set(next.dots.map((label) => label.key));
	const settle = Math.max(0, Math.min(1, (progress - 0.5) * 2));
	const adjust = <T extends { key: string; box: Box; alpha: number }>(labels: T[], still: ReadonlySet<string>): T[] =>
		labels.flatMap((label) => {
			if (!still.has(label.key)) return arriving.some((box) => intersects(box, label.box)) ? [] : [label];
			// Arriving (or kept) where a card is leaving: held back until the card has mostly faded.
			return cards.leaving.some((box) => intersects(box, label.box)) ? [{ ...label, alpha: Math.min(label.alpha, settle) }] : [label];
		});
	return { regions: adjust(regions, stillRegions), dots: adjust(dots, stillDots), cards: next.cards };
}

/**
 * The labels mid-fade between two levels: what both levels draw stays at full
 * strength, what only the new level draws fades in, and what only the old one drew
 * fades out. `progress` is 0 at the switch and 1 when it is done.
 */
export function crossFade<T extends { key: string; alpha: number }>(next: readonly T[], previous: readonly T[], progress: number): T[] {
	const kept = new Set(previous.map((label) => label.key));
	const arriving = new Set(next.map((label) => label.key));
	const faded: T[] = [];
	for (const label of next) faded.push(kept.has(label.key) ? label : { ...label, alpha: progress });
	for (const label of previous) if (!arriving.has(label.key)) faded.push({ ...label, alpha: 1 - progress });
	return faded;
}
