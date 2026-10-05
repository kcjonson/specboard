import { describe, expect, it } from 'vitest';
import type { Box } from './box-index';
import { EDGE_MARKER_SIZE, placeEdgeMarkers, type EdgeMarkerInput } from './edge-markers';
import type { MapPoint } from './layout/types';

const plot: Box = { x: 0, y: 0, w: 1000, h: 500 };
const up = (key: string, text = '1'): EdgeMarkerInput => ({ key, kind: 'up-next', text });

const at = (points: Record<string, MapPoint>) => (key: string): MapPoint | undefined => points[key];

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const boxOf = (marker: { x: number; y: number }): Box => ({ x: marker.x - EDGE_MARKER_SIZE / 2, y: marker.y - EDGE_MARKER_SIZE / 2, w: EDGE_MARKER_SIZE, h: EDGE_MARKER_SIZE });

describe('edge markers', () => {
	it('marks nothing that is in view, and nothing the Map does not draw', () => {
		const placed = placeEdgeMarkers([up('A'), up('B')], { plot, avoid: [], locate: at({ A: { x: 500, y: 250 } }) });
		expect(placed).toEqual([]);
	});

	it('puts a marker where the line from the middle to the item crosses the edge, pointing at it', () => {
		const [left, right, top, bottom] = placeEdgeMarkers([up('L'), up('R'), up('T'), up('B')], {
			plot,
			avoid: [],
			locate: at({ L: { x: -400, y: 250 }, R: { x: 1600, y: 250 }, T: { x: 500, y: -300 }, B: { x: 500, y: 900 } }),
		});
		expect(left!.x).toBeLessThan(EDGE_MARKER_SIZE);
		expect(left!.y).toBeCloseTo(250);
		expect(left!.angle).toBeCloseTo(Math.PI);
		expect(right!.x).toBeGreaterThan(1000 - EDGE_MARKER_SIZE * 1.5);
		expect(right!.angle).toBeCloseTo(0);
		expect(top!.y).toBeLessThan(EDGE_MARKER_SIZE);
		expect(top!.angle).toBeCloseTo(-Math.PI / 2);
		expect(bottom!.y).toBeGreaterThan(500 - EDGE_MARKER_SIZE * 1.5);
		expect(bottom!.angle).toBeCloseTo(Math.PI / 2);
	});

	it('slides along the edge toward a diagonal item, and stays whole inside the plot', () => {
		const [marker] = placeEdgeMarkers([up('A')], { plot, avoid: [], locate: at({ A: { x: 3000, y: 100 } }) });
		expect(marker!.x).toBeGreaterThan(1000 - EDGE_MARKER_SIZE * 1.5);
		expect(marker!.y).toBeGreaterThan(EDGE_MARKER_SIZE / 2);
		expect(marker!.y).toBeLessThan(250);
		const [corner] = placeEdgeMarkers([up('A')], { plot, avoid: [], locate: at({ A: { x: 4000, y: -4000 } }) });
		expect(boxOf(corner!).x + EDGE_MARKER_SIZE).toBeLessThanOrEqual(1000);
		expect(boxOf(corner!).y).toBeGreaterThanOrEqual(0);
	});

	it('keeps clear of the toolbar, the minimap, and the stepping bar by sliding along the edge', () => {
		const toolbar: Box = { x: 0, y: 0, w: 220, h: 60 };
		const minimap: Box = { x: 0, y: 380, w: 216, h: 120 };
		const bar: Box = { x: 380, y: 0, w: 240, h: 50 };
		const placed = placeEdgeMarkers([up('L1'), up('L2'), up('T')], {
			plot,
			avoid: [toolbar, minimap, bar],
			// Both left items sit where the toolbar and the minimap are; the third points at the bar.
			locate: at({ L1: { x: -300, y: -100 }, L2: { x: -300, y: 480 }, T: { x: 500, y: -200 } }),
		});
		expect(placed).toHaveLength(3);
		for (const marker of placed) for (const box of [toolbar, minimap, bar]) expect(overlaps(boxOf(marker), box)).toBe(false);
		// Still on the left edge, and still toward the item's side of what it dodged.
		expect(placed[0]!.x).toBeLessThan(EDGE_MARKER_SIZE);
		expect(placed[1]!.x).toBeLessThan(EDGE_MARKER_SIZE);
	});

	it('keeps off the drawer, which covers the right of the plot', () => {
		const [marker] = placeEdgeMarkers([up('A')], { plot: { x: 0, y: 0, w: 600, h: 500 }, avoid: [], locate: at({ A: { x: 900, y: 250 } }) });
		expect(boxOf(marker!).x + EDGE_MARKER_SIZE).toBeLessThanOrEqual(600);
		// An item under the drawer is out of view, so it is marked.
		expect(marker!.key).toBe('A');
	});

	it('does not stack two markers: the earlier one keeps its spot', () => {
		const placed = placeEdgeMarkers([up('A', '1'), up('B', '2'), up('C', '3')], {
			plot,
			avoid: [],
			locate: at({ A: { x: -300, y: 250 }, B: { x: -300, y: 252 }, C: { x: -300, y: 248 } }),
		});
		expect(placed.map((marker) => marker.key)).toEqual(['A', 'B', 'C']);
		expect(placed[0]!.y).toBeCloseTo(250);
		for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(boxOf(placed[i]!), boxOf(placed[j]!))).toBe(false);
	});

	it('serves every kind from one list, keeping the kind and the text', () => {
		const placed = placeEdgeMarkers(
			[up('A'), { key: 'B', kind: 'live' }, { key: 'C', kind: 'needs-person' }],
			{ plot, avoid: [], locate: at({ A: { x: -300, y: 100 }, B: { x: 1300, y: 100 }, C: { x: 500, y: 900 } }) },
		);
		expect(placed.map((marker) => [marker.key, marker.kind, marker.text])).toEqual([['A', 'up-next', '1'], ['B', 'live', undefined], ['C', 'needs-person', undefined]]);
	});

	it('leaves a marker out rather than put it on something when its whole edge is taken', () => {
		const wall: Box = { x: 0, y: 0, w: 60, h: 500 };
		expect(placeEdgeMarkers([up('A')], { plot, avoid: [wall], locate: at({ A: { x: -300, y: 250 } }) })).toEqual([]);
	});

	it('has no room to place anything in a plot smaller than a marker', () => {
		expect(placeEdgeMarkers([up('A')], { plot: { x: 0, y: 0, w: 20, h: 20 }, avoid: [], locate: at({ A: { x: 500, y: 500 } }) })).toEqual([]);
	});
});
