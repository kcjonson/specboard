import { describe, expect, it } from 'vitest';
import { intersects } from './box-index';
import { MARKER_SIZE, placeEdgeMarkers, type EdgeMarkerInput, type EdgeTarget } from './edge-markers';

const plot = { x: 0, y: 0, w: 1000, h: 500 };
const identity = { k: 1, x: 0, y: 0 };
const HALF = MARKER_SIZE / 2 + 6;

const target = (key: string, x: number, y: number, kind: EdgeTarget['kind'] = 'live'): EdgeTarget => ({ key, kind, label: key, at: { x, y } });

function place(targets: EdgeTarget[], over: Partial<EdgeMarkerInput> = {}): ReturnType<typeof placeEdgeMarkers> {
	return placeEdgeMarkers({ targets, transform: identity, plot, reserved: [], ...over });
}

describe('edge markers', () => {
	it('marks nothing that is in view', () => {
		expect(place([target('a', 500, 250), target('b', 0, 0), target('c', 1000, 500)])).toEqual([]);
	});

	it('sits where the line from the middle of the plot to the target crosses the edge, pointing along it', () => {
		const [right] = place([target('r', 1500, 250)]);
		expect(right).toMatchObject({ key: 'r', count: 1 });
		expect(right!.x).toBeCloseTo(1000 - HALF);
		expect(right!.y).toBeCloseTo(250);
		expect(right!.angle).toBeCloseTo(0);

		const [left] = place([target('l', -400, 250)]);
		expect(left!.x).toBeCloseTo(HALF);
		expect(left!.angle).toBeCloseTo(Math.PI);

		const [above] = place([target('t', 500, -300)]);
		expect(above!.x).toBeCloseTo(500);
		expect(above!.y).toBeCloseTo(HALF);
		expect(above!.angle).toBeCloseTo(-Math.PI / 2);

		const [below] = place([target('b', 500, 900)]);
		expect(below!.x).toBeCloseTo(500);
		expect(below!.y).toBeCloseTo(500 - HALF);
		expect(below!.angle).toBeCloseTo(Math.PI / 2);
	});

	it('follows the ray, so a target off the corner lands on the edge it leaves through', () => {
		// Right and a little down: leaves through the right edge, proportionally below the middle.
		const [marker] = place([target('d', 2000, 450)]);
		expect(marker!.x).toBeCloseTo(1000 - HALF);
		expect(marker!.y).toBeCloseTo(250 + (200 * (1000 - HALF - 500)) / 1500, 5);
		expect(marker!.angle).toBeCloseTo(Math.atan2(200, 1500));
	});

	it('reads targets through the camera', () => {
		// At 2x, panned 400 left: layout x 700 is screen 1000, just on the edge and in view; 800 is out.
		expect(place([target('in', 700, 125)], { transform: { k: 2, x: -400, y: 0 } })).toEqual([]);
		expect(place([target('out', 800, 125)], { transform: { k: 2, x: -400, y: 0 } })).toHaveLength(1);
	});

	it('treats the part of the plot the drawer covers as off screen', () => {
		const narrow = { x: 0, y: 0, w: 700, h: 500 };
		expect(place([target('under-drawer', 800, 250)], { plot: narrow })).toHaveLength(1);
		expect(place([target('under-drawer', 800, 250)], { plot: narrow })[0]!.x).toBeCloseTo(700 - HALF);
	});

	it('slides along the edge to clear the toolbar and the minimap', () => {
		const toolbar = { x: 8, y: 8, w: 360, h: 44 };
		const minimap = { x: 8, y: 380, w: 200, h: 112 };
		const [up] = place([target('up', -100, -300)], { reserved: [toolbar, minimap] });
		expect(up!.y).toBeCloseTo(HALF);
		const box = { x: up!.x - MARKER_SIZE / 2, y: up!.y - MARKER_SIZE / 2, w: MARKER_SIZE, h: MARKER_SIZE };
		expect(intersects(box, toolbar)).toBe(false);
		// It slid right past the toolbar, and is still on the top edge.
		expect(up!.x).toBeGreaterThan(toolbar.x + toolbar.w);

		const [down] = place([target('down', -1000, 1250)], { reserved: [toolbar, minimap] });
		expect(down!.y).toBeCloseTo(500 - HALF);
		expect(down!.x).toBeGreaterThan(minimap.x + minimap.w);

		const [west] = place([target('west', -500, -208)], { reserved: [toolbar, minimap] });
		expect(west!.x).toBeCloseTo(HALF);
		expect(west!.y).toBeGreaterThan(toolbar.y + toolbar.h);
	});

	it('stands for crowded targets of one kind with one marker, named for the nearest, and counts them', () => {
		const markers = place([target('far', 3000, 250), target('near', 1100, 250), target('mid', 1500, 252)]);
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({ key: 'near', label: 'near', count: 3 });
	});

	it('keeps targets apart that are far enough along the edge, and kinds apart from each other', () => {
		const spread = place([target('top', 500, -300), target('bottom', 500, 900), target('right', 1400, 250)]);
		expect(spread.map((m) => m.key).sort()).toEqual(['bottom', 'right', 'top']);

		const mixed = place([target('live', 1500, 250, 'live'), target('needs', 1500, 250, 'needs-person')]);
		expect(mixed.map((m) => m.kind).sort()).toEqual(['live', 'needs-person']);
		const [a, b] = mixed;
		expect(intersects({ x: a!.x - 14, y: a!.y - 14, w: 28, h: 28 }, { x: b!.x - 14, y: b!.y - 14, w: 28, h: 28 })).toBe(false);
	});

	it('drops a marker that has no room on its edge', () => {
		const wall = { x: 900, y: 0, w: 100, h: 500 };
		expect(place([target('walled', 1500, 250)], { reserved: [wall] })).toEqual([]);
	});

	it('is the same on every frame for the same input', () => {
		const targets = [target('a', 1300, 100), target('b', 1300, 110), target('c', -200, 400, 'needs-person')];
		expect(place(targets)).toEqual(place(targets));
	});
});
