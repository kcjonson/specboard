import { intersects, type Box } from '../box-index';
import type { Transform, Viewport } from '../camera';
import { screenPoint } from '../dot-boxes';
import type { DrawDot } from '../draw-list';

/**
 * Which dots carry a card at the near level. A card is real DOM, so only the ones in
 * view are mounted: panning swaps a few at the edges and never touches the rest.
 */

export const CARD_WIDTH = 184;
/**
 * Every card is exactly this tall, so placement knows its box before it renders: padding,
 * the key row, two title lines, and one row of marks.
 */
export const CARD_HEIGHT = 92;
/** Cards keep this far from each other and from everything else, on top of the labels' own clearance. */
export const CARD_GAP = 6;
/** Where the card's status glyph is centered, from its top left; the glyph sits on its dot. */
export const CARD_ANCHOR = { x: 16.5, y: 16.5 };
/** Cards this far past the plot's edge stay mounted, so a pan never shows one arriving. */
export const CULL_MARGIN = 48;
/** More than this many in view means the zoom is wrong for cards; the ones nearest the middle stay. */
export const MAX_CARDS = 300;

/** The card's box in screen pixels, from the camera's transform. */
export function cardBox(dot: DrawDot, transform: Transform): Box {
	const { x, y } = screenPoint(transform, dot);
	return { x: x - CARD_ANCHOR.x, y: y - CARD_ANCHOR.y, w: CARD_WIDTH, h: CARD_HEIGHT };
}

export function visibleCards(dots: readonly DrawDot[], transform: Transform, viewport: Viewport): DrawDot[] {
	const view: Box = { x: -CULL_MARGIN, y: -CULL_MARGIN, w: viewport.width + 2 * CULL_MARGIN, h: viewport.height + 2 * CULL_MARGIN };
	const inView = dots.filter((dot) => intersects(cardBox(dot, transform), view));
	if (inView.length > MAX_CARDS) {
		const cx = viewport.width / 2;
		const cy = viewport.height / 2;
		const distance = (dot: DrawDot): number => {
			const { x, y } = screenPoint(transform, dot);
			return (x - cx) ** 2 + (y - cy) ** 2;
		};
		inView.sort((a, b) => distance(a) - distance(b));
		inView.length = MAX_CARDS;
	}
	// Later (further right) cards draw over earlier ones: a card's left end, with the glyph and key, is what stays readable under a neighbor.
	return inView.sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
}
