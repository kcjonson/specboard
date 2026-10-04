import { describe, expect, it } from 'vitest';
import type { Box } from '../box-index';
import { QUICK_GAP, placeQuickCard } from './quick-card-placement';

const plot: Box = { x: 0, y: 0, w: 1000, h: 600 };
const size = { w: 288, h: 200 };
const dot = (x: number, y: number): Box => ({ x: x - 8, y: y - 8, w: 16, h: 16 });

describe('where the quick card opens', () => {
	it('opens to the right of the item when nothing is in the way', () => {
		const anchor = dot(300, 300);
		const placed = placeQuickCard({ anchor, related: [], plot, reserved: [], size });
		expect(placed.side).toBe('right');
		expect(placed.x).toBe(anchor.x + anchor.w + QUICK_GAP);
		expect(placed.y).toBe(300 - size.h / 2);
	});

	it('takes the side that covers the fewest related items', () => {
		const anchor = dot(500, 300);
		// Three related items sit on the right and one on the left.
		const related = [dot(540, 280), dot(600, 330), dot(700, 300), dot(400, 300)];
		const placed = placeQuickCard({ anchor, related, plot, reserved: [], size });
		expect(placed.side).toBe('left');

		const fewerOnRight = placeQuickCard({ anchor, related: [dot(400, 300), dot(380, 250), dot(300, 330)], plot, reserved: [], size });
		expect(fewerOnRight.side).toBe('right');
	});

	it('falls to above or below when both sides are crowded', () => {
		const anchor = dot(500, 300);
		const related = [dot(540, 300), dot(600, 300), dot(700, 300), dot(760, 300), dot(450, 300), dot(380, 300), dot(300, 320)];
		const placed = placeQuickCard({ anchor, related, plot, reserved: [], size });
		expect(['below', 'above']).toContain(placed.side);
	});

	it('is clamped inside the plot, so it never runs off an edge', () => {
		const nearRight = placeQuickCard({ anchor: dot(990, 590), related: [], plot, reserved: [], size });
		expect(nearRight.x).toBeGreaterThanOrEqual(0);
		expect(nearRight.x + size.w).toBeLessThanOrEqual(plot.w);
		expect(nearRight.y + size.h).toBeLessThanOrEqual(plot.h);
		const nearTop = placeQuickCard({ anchor: dot(500, 4), related: [], plot, reserved: [], size });
		expect(nearTop.y).toBeGreaterThanOrEqual(0);
	});

	it('never sits under the drawer: the plot it is given ends where the drawer starts', () => {
		const withDrawer = { ...plot, w: 600 };
		const placed = placeQuickCard({ anchor: dot(560, 300), related: [], plot: withDrawer, reserved: [], size });
		expect(placed.x + size.w).toBeLessThanOrEqual(600);
		// With no room on the right it opens on the left, clear of the item.
		expect(placed.side).toBe('left');
	});

	it('keeps off the toolbar and the minimap', () => {
		const toolbar: Box = { x: 520, y: 150, w: 400, h: 300 };
		const placed = placeQuickCard({ anchor: dot(500, 300), related: [], plot, reserved: [toolbar], size });
		expect(placed.side).not.toBe('right');
	});
});
