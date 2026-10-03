import { describe, expect, it, vi } from 'vitest';
import {
	FIT_PADDING,
	ZOOM_STEP,
	centerOf,
	fitTransform,
	openTransform,
	readableScale,
	type Transform,
	type Viewport,
} from './camera';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import type { MapCamera } from './map-camera';
import { MapSurface } from './map-surface';
import { RULER_HEIGHT, type MapFrame, type MapRenderer } from './renderer';

class FakeCamera implements MapCamera {
	transform: Transform = { k: 1, x: 0, y: 0 };
	listeners = new Set<() => void>();
	configured: { viewport: Viewport; minScale: number } | null = null;
	flights: Transform[] = [];
	zooms: number[] = [];

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	configure(viewport: Viewport, _bounds: unknown, minScale: number): void {
		this.configured = { viewport, minScale };
	}

	set(transform: Transform): void {
		this.transform = transform;
		for (const listener of this.listeners) listener();
	}

	flyTo(transform: Transform): void {
		this.flights.push(transform);
		this.set(transform);
	}

	zoomBy(factor: number): void {
		this.zooms.push(factor);
	}

	destroy(): void {
		this.listeners.clear();
	}
}

class FakeRenderer implements MapRenderer {
	frames: MapFrame[] = [];
	size = { width: 0, height: 0 };
	themeReads = 0;

	resize(width: number, height: number): void {
		this.size = { width, height };
	}

	refreshTheme(): void {
		this.themeReads++;
	}

	draw(frame: MapFrame): void {
		this.frames.push(frame);
	}
}

function setup(): {
	surface: MapSurface;
	camera: FakeCamera;
	renderer: FakeRenderer;
	frames: Array<() => void>;
	empty: ReturnType<typeof vi.fn>;
	settle: ReturnType<typeof vi.fn>;
	flush: () => void;
} {
	const camera = new FakeCamera();
	const renderer = new FakeRenderer();
	const frames: Array<() => void> = [];
	const empty = vi.fn();
	const settle = vi.fn();
	const surface = new MapSurface(
		{ renderer, camera, schedule: (paint) => frames.push(paint), timeZone: 'UTC' },
		{ onViewportEmpty: empty, onSettle: settle },
	);
	return { surface, camera, renderer, frames, empty, settle, flush: () => frames.splice(0).forEach((paint) => paint()) };
}

const WIDTH = 1000;
const HEIGHT = 500 + RULER_HEIGHT;
const plot: Viewport = { width: WIDTH, height: 500 };

function realBoard(): { layout: MapLayout; rows: Map<string, ReturnType<BoardBuilder['add']>>; keys: string[] } {
	const b = new BoardBuilder();
	const keys: string[] = [];
	for (let i = 0; i < 12; i++) keys.push(b.add({ status: i < 6 ? 'done' : 'ready', created: b.now - (20 - i) * 86_400_000 }).key);
	// Something in flight now, so the board is live and its edge is now.
	keys.push(b.add({ status: 'in_progress' }).key);
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	return { layout, rows: new Map(b.rows.map((row) => [row.key, row])), keys };
}

describe('MapSurface', () => {
	it('sizes the renderer for the whole canvas and the camera for the plot above the ruler', () => {
		const { surface, camera, renderer } = setup();
		surface.resize(WIDTH, HEIGHT);
		expect(renderer.size).toEqual({ width: WIDTH, height: HEIGHT });
		surface.show(realBoard().layout, new Map(), null);
		expect(camera.configured!.viewport).toEqual(plot);
	});

	it('paints only on demand, once per frame however many things changed', () => {
		const { surface, camera, renderer, frames, flush } = setup();
		surface.resize(WIDTH, HEIGHT);
		flush();
		expect(frames).toHaveLength(0);
		const before = renderer.frames.length;

		camera.set({ k: 2, x: 0, y: 0 });
		camera.set({ k: 3, x: 0, y: 0 });
		surface.refreshTheme();
		expect(frames).toHaveLength(1);
		flush();
		expect(renderer.frames.length).toBe(before + 1);
		expect(renderer.themeReads).toBe(1);

		flush();
		expect(renderer.frames.length).toBe(before + 1);
	});

	it('draws the ruler frame alone until a layout arrives', () => {
		const { surface, renderer, flush } = setup();
		surface.resize(WIDTH, HEIGHT);
		surface.clear();
		flush();
		expect(renderer.frames.at(-1)).toMatchObject({ dots: [], ruler: null });
	});

	it('opens per decision 11: fit all when the whole Map fits readably', () => {
		const { surface, camera, flush, renderer } = setup();
		const { layout, rows } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		expect(camera.transform).toEqual(fitTransform(layout.frame.bounds, plot));
		expect(camera.transform.k).toBeGreaterThanOrEqual(readableScale());
		const frame = renderer.frames.at(-1)!;
		expect(frame.dots).toHaveLength(13);
		expect(frame.ruler!.edge.label).toBe('Now');
	});

	it('opens on the recent stretch at the readable scale when the Map is too wide for that', () => {
		const { surface, camera } = setup();
		const { layout, rows } = realBoard();
		// A plot so narrow that fit all would shrink a dot under the readable radius.
		surface.resize(120, HEIGHT);
		surface.show(layout, rows, null);
		expect(camera.transform.k).toBeCloseTo(readableScale());
		expect(openTransform(layout.frame.bounds, [], { width: 120, height: 500 }).k).toBeCloseTo(readableScale());
		expect(camera.transform.x + camera.transform.k * layout.frame.bounds.maxX).toBeCloseTo(120 - FIT_PADDING);
	});

	it('opens centered on an item named in the URL, and on the default view when it is not on the Map', () => {
		const { surface, camera } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, keys[2]!);
		const node = layout.nodes.find((n) => n.key === keys[2])!;
		expect(centerOf(camera.transform, plot)).toEqual({ x: expect.closeTo(node.x), y: expect.closeTo(node.y) });

		surface.show(layout, rows, 'NOPE-1');
		expect(camera.transform).toEqual(fitTransform(layout.frame.bounds, plot));
	});

	it('flies to fit all, to now, and to an item, and zooms about the middle', () => {
		const { surface, camera } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);

		surface.fitAll();
		surface.now();
		expect(surface.focusOn(keys[0]!)).toBe(true);
		expect(surface.focusOn('NOPE-1')).toBe(false);
		expect(camera.flights).toHaveLength(3);
		const node = layout.nodes.find((n) => n.key === keys[0])!;
		expect(centerOf(camera.flights[2]!, plot)).toEqual({ x: expect.closeTo(node.x), y: expect.closeTo(node.y) });

		surface.zoomIn();
		surface.zoomOut();
		expect(camera.zooms).toEqual([ZOOM_STEP, 1 / ZOOM_STEP]);
	});

	it('can move to an item without a flight', () => {
		const { surface, camera } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		surface.focusOn(keys[1]!, false);
		expect(camera.flights).toHaveLength(0);
		const node = layout.nodes.find((n) => n.key === keys[1])!;
		expect(centerOf(camera.transform, plot).x).toBeCloseTo(node.x);
	});

	it('offers a jump when the plot holds no dot, and takes it to the nearest one', () => {
		const { surface, camera, empty, flush } = setup();
		const { layout, rows } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		expect(empty).not.toHaveBeenCalled();

		// Far past everything, as a person could pan to.
		camera.set({ k: 2, x: -100000, y: 0 });
		flush();
		expect(empty).toHaveBeenLastCalledWith(true);

		const key = surface.jumpToNearest();
		expect(key).not.toBeNull();
		flush();
		expect(empty).toHaveBeenLastCalledWith(false);
		const node = layout.nodes.find((n) => n.key === key)!;
		expect(centerOf(camera.transform, plot).x).toBeCloseTo(node.x);
	});

	it('is never empty on a Map with no dots: that is the empty state, not a lost viewport', () => {
		const { surface, camera, empty, flush } = setup();
		surface.resize(WIDTH, HEIGHT);
		surface.clear();
		camera.set({ k: 2, x: -100000, y: 0 });
		flush();
		expect(empty).not.toHaveBeenCalled();
	});

	it('names the item in the middle of the plot once the person settles', () => {
		const { surface, settle } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, keys[4]!);
		surface.settled();
		expect(settle).toHaveBeenCalledWith(keys[4]);
	});

	it('holds the middle of the view across a resize once the person has moved, and reopens it before', () => {
		const { surface, camera } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		surface.resize(800, 420 + RULER_HEIGHT);
		expect(camera.transform).toEqual(fitTransform(layout.frame.bounds, { width: 800, height: 420 }));

		surface.focusOn(keys[3]!, false);
		surface.settled();
		const before = centerOf(camera.transform, { width: 800, height: 420 });
		surface.resize(WIDTH, HEIGHT);
		const after = centerOf(camera.transform, plot);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('reopens the default view on request', () => {
		const { surface, camera } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, keys[0]!);
		surface.reopen();
		expect(camera.transform).toEqual(fitTransform(layout.frame.bounds, plot));
	});
});
