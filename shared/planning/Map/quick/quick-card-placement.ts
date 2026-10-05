import { intersects, type Box } from '../box-index';

/**
 * Where the quick card opens (spec, What shows when): beside the item, on whichever
 * side covers the fewest of its related items, and clamped inside the plot so it never
 * sits under the toolbar, the minimap, or the drawer.
 */
export type QuickSide = 'right' | 'left' | 'below' | 'above';

/** Tried in this order, which is also how a tie falls: beside the item, reading direction first. */
const SIDES: readonly QuickSide[] = ['right', 'left', 'below', 'above'];

/** Between the item and its card. */
export const QUICK_GAP = 12;

export interface QuickPlacementInput {
	/** The item's box on screen: its dot, or the near-level card standing in for it. */
	anchor: Box;
	/** Boxes of the dots the card would hide, each of them a related item. */
	related: readonly Box[];
	/** Where the card may sit: the plot less the drawer. */
	plot: Box;
	/** The toolbar and the minimap, which it keeps off. */
	reserved: readonly Box[];
	/** The item's own region's label, which it avoids covering: it names where the item lives. */
	ownLabel?: Box | null;
	size: { w: number; h: number };
}

export interface QuickPlacement {
	x: number;
	y: number;
	side: QuickSide;
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function boxOn(side: QuickSide, { anchor, size }: QuickPlacementInput): Box {
	const { w, h } = size;
	switch (side) {
		case 'right':
			return { x: anchor.x + anchor.w + QUICK_GAP, y: anchor.y + anchor.h / 2 - h / 2, w, h };
		case 'left':
			return { x: anchor.x - QUICK_GAP - w, y: anchor.y + anchor.h / 2 - h / 2, w, h };
		case 'below':
			return { x: anchor.x + anchor.w / 2 - w / 2, y: anchor.y + anchor.h + QUICK_GAP, w, h };
		case 'above':
			return { x: anchor.x + anchor.w / 2 - w / 2, y: anchor.y - QUICK_GAP - h, w, h };
	}
}

/** What a side costs: the item itself under the card is worst, then reserved chrome, then the item's own region label, then each related item hidden, then how far the plot's edge pushed it. */
function cost(box: Box, shift: number, input: QuickPlacementInput): number {
	let total = shift / 1000;
	if (intersects(box, input.anchor)) total += 10_000;
	for (const reserved of input.reserved) if (intersects(box, reserved)) total += 1000;
	if (input.ownLabel && intersects(box, input.ownLabel)) total += 100;
	for (const related of input.related) if (intersects(box, related)) total += 1;
	return total;
}

export function placeQuickCard(input: QuickPlacementInput): QuickPlacement {
	const { plot, size } = input;
	let best: QuickPlacement | null = null;
	let bestCost = Infinity;
	for (const side of SIDES) {
		const wanted = boxOn(side, input);
		const x = clamp(wanted.x, plot.x, Math.max(plot.x, plot.x + plot.w - size.w));
		const y = clamp(wanted.y, plot.y, Math.max(plot.y, plot.y + plot.h - size.h));
		const total = cost({ x, y, w: size.w, h: size.h }, Math.abs(x - wanted.x) + Math.abs(y - wanted.y), input);
		if (total < bestCost) {
			best = { x, y, side };
			bestCost = total;
		}
	}
	return best!;
}
