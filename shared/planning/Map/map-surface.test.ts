import { describe, expect, it, vi } from 'vitest';
import {
	FIT_PADDING,
	ZOOM_STEP,
	centerOf,
	centeredOn,
	fitTransform,
	openTransform,
	readableScale,
	type Transform,
	type Viewport,
} from './camera';
import { BoardBuilder } from './layout/board-fixture';
import { LEAF_RADIUS } from './layout/constants';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import type { MapCamera, ScreenPoint } from './map-camera';
import { MapSurface } from './map-surface';
import { OverlayStore } from './overlay';
import { edgeLabelAt } from './ruler';
import { gridStep } from './regions/region-outlines';
import { RULER_HEIGHT, type MapFrame, type MapRenderer } from './renderer';
import { cardBox } from './cards/card-culling';
import { FADE_MS, NEAR_ENTER, NEAR_EXIT } from './zoom-levels';

class FakeCamera implements MapCamera {
	transform: Transform = { k: 1, x: 0, y: 0 };
	listeners = new Set<() => void>();
	configured: { viewport: Viewport; minScale: number } | null = null;
	flights: Transform[] = [];
	zooms: Array<{ factor: number; around?: ScreenPoint }> = [];

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

	zoomBy(factor: number, around?: ScreenPoint): void {
		this.zooms.push({ factor, around });
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

	measureLabel(text: string): number {
		return text.length * 7;
	}

	draw(frame: MapFrame): void {
		this.frames.push(frame);
	}
}

function setup(): {
	surface: MapSurface;
	camera: FakeCamera;
	renderer: FakeRenderer;
	overlay: OverlayStore;
	clock: { now: number; reduced: boolean };
	frames: Array<() => void>;
	empty: ReturnType<typeof vi.fn>;
	settle: ReturnType<typeof vi.fn>;
	flush: () => void;
	deferred: Array<() => void>;
} {
	const camera = new FakeCamera();
	const renderer = new FakeRenderer();
	const frames: Array<() => void> = [];
	const deferred: Array<() => void> = [];
	const empty = vi.fn();
	const settle = vi.fn();
	const overlay = new OverlayStore();
	const clock = { now: 0, reduced: false };
	const surface = new MapSurface(
		{
			renderer,
			camera,
			overlay,
			now: () => clock.now,
			reducedMotion: () => clock.reduced,
			schedule: (paint) => frames.push(paint),
			defer: (task) => deferred.push(task),
			timeZone: 'UTC',
		},
		{ onViewportEmpty: empty, onSettle: settle },
	);
	return { surface, camera, renderer, overlay, clock, frames, empty, settle, deferred, flush: () => frames.splice(0).forEach((paint) => paint()) };
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

		camera.set({ k: 1.2, x: 0, y: 0 });
		camera.set({ k: 1.3, x: 0, y: 0 });
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
		expect(camera.zooms).toEqual([{ factor: ZOOM_STEP }, { factor: 1 / ZOOM_STEP }]);
	});

	it('zooms by key about the pointer when it is over the plot, and about the middle otherwise', () => {
		const { surface, camera } = setup();
		surface.resize(WIDTH, HEIGHT);
		surface.setPointer({ x: 300, y: 120 });
		surface.zoomInByKey();
		surface.zoomOutByKey();
		expect(camera.zooms).toEqual([
			{ factor: ZOOM_STEP, around: { x: 300, y: 120 } },
			{ factor: 1 / ZOOM_STEP, around: { x: 300, y: 120 } },
		]);

		camera.zooms.length = 0;
		surface.setPointer({ x: 300, y: 520 + RULER_HEIGHT });
		surface.zoomInByKey();
		surface.setPointer(null);
		surface.zoomOutByKey();
		expect(camera.zooms).toEqual([{ factor: ZOOM_STEP, around: undefined }, { factor: 1 / ZOOM_STEP, around: undefined }]);
	});

	it('focuses an item that is not a dot of its own: a region\'s parent, and a child folded into its family', () => {
		const b = new BoardBuilder();
		const open = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: open.key, status: 'ready' });
		b.add({ parentKey: open.key, status: 'done' });
		const finished = b.add({ type: 'epic', status: 'done' });
		const folded = b.add({ parentKey: finished.key, status: 'done' });
		b.add({ parentKey: finished.key, status: 'done' });
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const { surface, camera } = setup();
		surface.resize(WIDTH, HEIGHT);

		const at = (key: string): { x: number; y: number } => layout.nodes.find((n) => n.key === key)!;
		expect(at(open.key).x).toBeDefined();
		surface.show(layout, rows, open.key);
		expect(centerOf(camera.transform, plot)).toEqual({ x: expect.closeTo(at(open.key).x), y: expect.closeTo(at(open.key).y) });

		surface.show(layout, rows, folded.key);
		expect(layout.representative[folded.key]).toBe(finished.key);
		expect(centerOf(camera.transform, plot)).toEqual({ x: expect.closeTo(at(finished.key).x), y: expect.closeTo(at(finished.key).y) });

		expect(surface.focusOn(open.key, false)).toBe(true);
		expect(surface.focusOn(folded.key, false)).toBe(true);
		expect(surface.focusOn('NOPE-1')).toBe(false);
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

function familyBoard(): { layout: MapLayout; rows: Map<string, ReturnType<BoardBuilder['add']>>; epic: string; finished: string; chain: [string, string] } {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress', title: 'Open family' });
	const first = b.add({ parentKey: epic.key, status: 'in_progress' });
	const second = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(second, first);
	b.add({ parentKey: epic.key, status: 'done' });
	const finished = b.add({ type: 'epic', status: 'done' });
	for (let i = 0; i < 30; i++) b.add({ parentKey: finished.key, status: 'done' });
	const loose = b.add({ status: 'ready' });
	b.block(loose, first);
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	return { layout, rows: new Map(b.rows.map((row) => [row.key, row])), epic: epic.key, finished: finished.key, chain: [first.key, second.key] };
}

describe('MapSurface regions, links, and collapse controls', () => {
	it('draws a region around each family, labels it, and draws its chain links at rest', () => {
		const { surface, renderer, flush } = setup();
		const { layout, rows, epic, chain } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		const frame = renderer.frames.at(-1)!;
		expect(frame.regions.map((r) => r.key)).toEqual([epic]);
		expect(frame.labels.map((l) => l.key)).toEqual([epic]);
		expect(frame.labels[0]!.title).toBe('Open family');
		expect(frame.lighting).toEqual({ all: false, lit: null });
		expect(frame.links.map((l) => l.id)).toContain(`chain:${chain[0]}>${chain[1]}`);
	});

	it('offers collapse on a region label and expand on a folded family, and names the one under the pointer', () => {
		const { surface, renderer, camera, flush } = setup();
		const { layout, rows, epic, finished } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		const { controls, labels } = renderer.frames.at(-1)!;
		expect(controls.map((c) => [c.key, c.collapse])).toEqual([[epic, true], [finished, false]]);
		expect(surface.controlAt(labels[0]!.toggle)).toEqual({ key: epic, collapse: true });
		expect(surface.controlAt({ x: 1, y: 1 })).toBeNull();

		// Controls follow the camera.
		camera.set({ ...camera.transform, x: camera.transform.x + 50 });
		flush();
		expect(surface.controlAt(labels[0]!.toggle)).toBeNull();
	});

	it('computes outlines once per layout and zoom bucket, never during a pan, and defers a new bucket past the gesture', () => {
		const { surface, renderer, camera, flush, deferred } = setup();
		const { layout, rows } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		const opened = renderer.frames.at(-1)!.regions;
		const at = camera.transform;

		for (let i = 1; i <= 3; i++) {
			camera.set({ ...at, x: at.x + 30 * i });
			flush();
			expect(renderer.frames.at(-1)!.regions).toBe(opened);
		}
		expect(deferred).toHaveLength(0);

		// Into another bucket: the cached outlines draw until the gesture is over.
		const k = gridStep(at.k) === gridStep(0.5) ? 3 : 0.5;
		expect(gridStep(k)).not.toBe(gridStep(at.k));
		camera.set({ ...at, k });
		flush();
		camera.set({ ...at, k: k * 1.05 });
		flush();
		expect(renderer.frames.at(-1)!.regions).toBe(opened);
		expect(deferred).toHaveLength(2);
		deferred.splice(0).forEach((task) => task());
		flush();
		const finer = renderer.frames.at(-1)!.regions;
		expect(finer).not.toBe(opened);
		expect(finer.map((r) => r.key)).toEqual(opened.map((r) => r.key));

		// Back out: both buckets are cached now.
		camera.set(at);
		flush();
		expect(renderer.frames.at(-1)!.regions).toBe(opened);
	});

	it('drops a deferred outline task once destroyed', () => {
		const { surface, renderer, camera, flush, frames, deferred, clock } = setup();
		clock.reduced = true;
		const { layout, rows } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		const at = camera.transform;
		camera.set({ ...at, k: gridStep(at.k) === gridStep(0.5) ? 3 : 0.5 });
		flush();
		expect(deferred).toHaveLength(1);
		const painted = renderer.frames.length;
		surface.destroy();
		deferred[0]!();
		expect(frames).toHaveLength(0);
		expect(renderer.frames.length).toBe(painted);
	});

	it('takes a new layout where the camera already is, as a collapse does', () => {
		const { surface, renderer, camera, flush } = setup();
		const { layout, rows, epic } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		expect(surface.showing).toBe(true);
		camera.set({ k: 3, x: -200, y: 40 });
		const collapsed = layoutMap({ rows: [...rows.values()], now: layout.frame.scale.edge, collapse: { [epic]: true }, aspect: WIDTH / 500 });
		surface.update(collapsed, rows);
		flush();
		expect(camera.transform).toEqual({ k: 3, x: -200, y: 40 });
		const frame = renderer.frames.at(-1)!;
		expect(frame.regions).toEqual([]);
		expect(frame.dots.find((d) => d.key === epic)!.folded).not.toBeNull();

		surface.clear();
		expect(surface.showing).toBe(false);
	});

	it('shows the links focus lights, or every link with All links on', () => {
		const { surface, renderer, flush } = setup();
		const { layout, rows } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const lit = { all: false, lit: new Set(['blocker:X>Y']) };
		surface.setLighting(lit);
		flush();
		expect(renderer.frames.at(-1)!.lighting).toBe(lit);
	});
});

describe('MapSurface labels, levels, cards, and the minimap', () => {
	const at = (layout: MapLayout, key: string): { x: number; y: number } => layout.nodes.find((n) => n.key === key)!;
	/** A view at scale k with an item in the middle of the plot. */
	const viewOf = (layout: MapLayout, key: string, k: number): Transform => centeredOn(at(layout, key), k, plot);
	const scaleFor = (radius: number): number => radius / LEAF_RADIUS;

	it('labels the in-progress item at fit all with its key and title, and not the ready ones', () => {
		const { surface, renderer, flush } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		const frame = renderer.frames.at(-1)!;
		const inProgress = keys.at(-1)!;
		expect(frame.dotLabels.map((label) => label.key)).toEqual([inProgress]);
		expect(frame.dotLabels[0]!.text.startsWith(`${inProgress} `)).toBe(true);
		expect(frame.dotLabels[0]!.alpha).toBe(1);
	});

	it('labels every dot with room once zoomed in to the middle level', () => {
		const { surface, camera, renderer, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		camera.set(viewOf(layout, keys[6]!, scaleFor(12)));
		flush();
		const labelled = renderer.frames.at(-1)!.dotLabels.map((label) => label.key);
		expect(labelled.length).toBeGreaterThan(1);
		expect(labelled).toContain(keys[6]);
	});

	it('leaves a named item without a label', () => {
		const { surface, camera, renderer, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const inProgress = keys.at(-1)!;
		surface.setNamed(new Set([inProgress]));
		flush();
		expect(renderer.frames.at(-1)!.dotLabels.map((label) => label.key)).not.toContain(inProgress);
		camera.set(viewOf(layout, keys[6]!, scaleFor(12)));
		flush();
		expect(renderer.frames.at(-1)!.dotLabels.map((label) => label.key)).not.toContain(inProgress);
	});

	it('mounts no cards before the near level, and cards for the dots in view at it', () => {
		const { surface, camera, renderer, overlay, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		expect(overlay.frame.cards).toBeNull();

		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		const { cards, cardAlpha } = overlay.frame;
		expect(cards).not.toBeNull();
		expect(cardAlpha).toBe(1);
		expect(cards!.dots.map((dot) => dot.key)).toContain(keys[6]);
		expect(cards!.k).toBeCloseTo(scaleFor(NEAR_ENTER + 2));
		expect(overlay.frame.rows).toBe(rows);
		// The canvas leaves a carded dot to its card, and draws the ones without.
		const drawn = renderer.frames.at(-1)!;
		expect(drawn.cards!.keys.has(keys[6]!)).toBe(true);
		expect(drawn.cards!.alpha).toBe(1);
		expect(drawn.dotLabels).toEqual([]);
	});

	it('keeps the same card set for a pan and makes a new one for a zoom', () => {
		const { surface, camera, overlay, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const view = viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2));
		camera.set(view);
		flush();
		const first = overlay.frame.cards;
		camera.set({ ...view, x: view.x + 3 });
		flush();
		expect(overlay.frame.cards).toBe(first);
		expect(overlay.frame.transform.x).toBe(view.x + 3);

		camera.set({ ...view, k: view.k * 1.1 });
		flush();
		expect(overlay.frame.cards).not.toBe(first);
	});

	it('fades labels and cards with a level switch, a frame at a time, then stops asking for frames', () => {
		const { surface, camera, renderer, overlay, flush, frames, clock } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		expect(frames).toHaveLength(0);

		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		// Just switched: the cards are not there yet, and a frame is asked for to carry the fade on.
		expect(overlay.frame.cardAlpha).toBeCloseTo(0, 1);
		expect(frames).toHaveLength(1);

		clock.now += FADE_MS / 4;
		flush();
		const rising = overlay.frame.cardAlpha;
		expect(rising).toBeGreaterThan(0);
		expect(rising).toBeLessThan(1);
		expect(renderer.frames.at(-1)!.cards!.alpha).toBe(rising);
		expect(frames).toHaveLength(1);

		clock.now += FADE_MS;
		flush();
		expect(overlay.frame.cardAlpha).toBe(1);
		// At rest nothing animates: no further frame is asked for.
		expect(frames).toHaveLength(0);
	});

	it('cuts, with no fade frames, under reduced motion', () => {
		const { surface, camera, overlay, flush, frames, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		expect(overlay.frame.cardAlpha).toBe(1);
		expect(frames).toHaveLength(0);
	});

	it('shows cards fading out and the middle level\'s labels fading in on the way back', () => {
		const { surface, camera, renderer, overlay, flush, clock } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		clock.now += FADE_MS * 2;
		flush();
		expect(overlay.frame.cardAlpha).toBe(1);

		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_EXIT - 2)));
		clock.now += 1;
		flush();
		clock.now += FADE_MS / 4;
		flush();
		const falling = overlay.frame.cardAlpha;
		expect(falling).toBeGreaterThan(0);
		expect(falling).toBeLessThan(1);
		const arriving = renderer.frames.at(-1)!.dotLabels.filter((label) => label.alpha < 1);
		expect(arriving.length).toBeGreaterThan(0);

		clock.now += FADE_MS * 2;
		flush();
		expect(overlay.frame.cards).toBeNull();
	});

	it('turns a fade around from where it was, not from fully shown', () => {
		const { surface, camera, overlay, flush, clock } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		clock.now += FADE_MS / 4;
		flush();
		const partway = overlay.frame.cardAlpha;
		expect(partway).toBeGreaterThan(0);
		expect(partway).toBeLessThan(1);

		// Back out before it finished: the cards start fading out from their current opacity.
		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_EXIT - 2)));
		clock.now += 1;
		flush();
		expect(overlay.frame.cardAlpha).toBeLessThanOrEqual(partway + 1e-9);
		expect(overlay.frame.cardAlpha).toBeGreaterThan(partway - 0.05);
		clock.now += FADE_MS * 2;
		flush();
		expect(overlay.frame.cards).toBeNull();
	});

	it('places cards and labels around the page\'s own controls and the minimap', () => {
		const { surface, camera, renderer, overlay, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const view = viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 4));
		// The toolbar over the top left, with the dot in the middle of the plot not under it.
		const toolbar = { x: 0, y: 0, w: 520, h: 300 };
		surface.setChrome([toolbar]);
		camera.set(view);
		flush();
		const { cards, minimap } = overlay.frame;
		expect(cards).not.toBeNull();
		const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
		for (const dot of cards!.dots) {
			const box = cardBox(dot, camera.transform);
			expect(overlaps(box, toolbar), `${dot.key} under the toolbar`).toBe(false);
			if (minimap) expect(overlaps(box, minimap.panel), `${dot.key} under the minimap`).toBe(false);
		}
		const frame = renderer.frames.at(-1)!;
		for (const label of [...frame.dotLabels.map((l) => l.box), ...frame.labels.map((l) => l.box)]) {
			expect(overlaps(label, toolbar)).toBe(false);
			if (minimap) expect(overlaps(label, minimap.panel)).toBe(false);
		}
	});

	it('keeps region labels out from under the cards, which are DOM over the canvas', () => {
		const { surface, camera, renderer, overlay, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, chain } = familyBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		camera.set(viewOf(layout, chain[0], scaleFor(NEAR_ENTER + 4)));
		flush();
		const { cards } = overlay.frame;
		expect(cards).not.toBeNull();
		const boxes = cards!.dots.map((dot) => cardBox(dot, camera.transform));
		for (const { box } of renderer.frames.at(-1)!.labels) {
			for (const card of boxes) expect(box.x < card.x + card.w && box.x + box.w > card.x && box.y < card.y + card.h && box.y + box.h > card.y).toBe(false);
		}
	});

	it('does not change level for a camera hovering at a boundary', () => {
		const { surface, camera, overlay, flush, clock } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		clock.reduced = true;
		let flips = 0;
		let last: boolean | null = null;
		for (let i = 0; i < 40; i++) {
			camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + (i % 2 === 0 ? 0.3 : -0.3))));
			flush();
			const has = overlay.frame.cards !== null;
			if (last !== null && has !== last) flips++;
			last = has;
		}
		// The first frame crosses into near; after that it holds.
		expect(flips).toBe(0);
		expect(last).toBe(true);
	});

	it('shows the minimap only once zoomed in past fit all, and reserves its box against labels', () => {
		const { surface, camera, overlay, renderer, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		expect(overlay.frame.minimap).toBeNull();

		const fit = fitTransform(layout.frame.bounds, plot).k;
		camera.set(viewOf(layout, keys[6]!, fit * 2.4));
		flush();
		const { minimap } = overlay.frame;
		expect(minimap).not.toBeNull();
		expect(minimap!.panel.x).toBeLessThan(plot.width / 4);
		expect(minimap!.panel.y + minimap!.panel.h).toBeLessThanOrEqual(plot.height);
		expect(minimap!.dots).toHaveLength(13);
		// Labels keep off it, wherever the camera puts them.
		const { panel } = minimap!;
		for (const label of renderer.frames.at(-1)!.dotLabels) {
			const hits = label.box.x < panel.x + panel.w && label.box.x + label.box.w > panel.x && label.box.y < panel.y + panel.h && label.box.y + label.box.h > panel.y;
			expect(hits).toBe(false);
		}

		camera.set(fitTransform(layout.frame.bounds, plot));
		flush();
		expect(overlay.frame.minimap).toBeNull();
	});

	it('moves the camera to a point picked in the minimap, flying for a click and cutting for a drag, and names what is there', () => {
		const { surface, camera, flush, settle } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const k = camera.transform.k * 2;
		camera.set({ ...camera.transform, k });
		flush();

		const target = at(layout, keys[3]!);
		surface.centerOn(target, true);
		expect(camera.flights).toHaveLength(1);
		expect(camera.transform.k).toBe(k);
		expect(centerOf(camera.transform, plot)).toEqual({ x: expect.closeTo(target.x), y: expect.closeTo(target.y) });
		expect(settle).toHaveBeenLastCalledWith(keys[3]);

		surface.centerOn(at(layout, keys[5]!), false);
		expect(camera.flights).toHaveLength(1);
		expect(centerOf(camera.transform, plot).x).toBeCloseTo(at(layout, keys[5]!).x);
	});

	it('keeps labels off the edge\'s own label, which the renderer draws last', () => {
		const { surface, camera, renderer, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		// Zoomed in on the in-flight item, which sits at the edge, so labels crowd its label.
		camera.set(viewOf(layout, keys.at(-1)!, scaleFor(14)));
		flush();
		const frame = renderer.frames.at(-1)!;
		const edge = edgeLabelAt(frame.ruler!.edge.x, renderer.measureLabel(frame.ruler!.edge.label), plot.width)!;
		expect(frame.dotLabels.length).toBeGreaterThan(0);
		for (const label of frame.dotLabels) {
			const { box } = label;
			expect(box.x < edge.box.x + edge.box.w && box.x + box.w > edge.box.x && box.y < edge.box.y + edge.box.h && box.y + box.h > edge.box.y).toBe(false);
		}
	});

	it('stops painting and asking for frames once torn down, even in the middle of a fade', () => {
		const { surface, camera, renderer, overlay, flush, frames, clock } = setup();
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		flush();
		camera.set(viewOf(layout, keys[6]!, scaleFor(NEAR_ENTER + 2)));
		flush();
		expect(frames).toHaveLength(1);
		const painted = renderer.frames.length;
		const published = overlay.frame;

		surface.destroy();
		clock.now += FADE_MS / 4;
		flush();
		expect(renderer.frames.length).toBe(painted);
		expect(overlay.frame).toBe(published);
		expect(frames).toHaveLength(0);
	});

	it('carries the camera\'s own center and the plot\'s span for the minimap\'s keys', () => {
		const { surface, camera, overlay, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows, keys } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const fit = fitTransform(layout.frame.bounds, plot).k;
		const view = viewOf(layout, keys[6]!, fit * 2.4);
		camera.set(view);
		flush();
		const { minimap } = overlay.frame;
		expect(minimap!.center).toEqual(centerOf(view, plot));
		expect(minimap!.span.width).toBeCloseTo(plot.width / view.k);
		expect(minimap!.span.height).toBeCloseTo(plot.height / view.k);
	});

	it('holds a minimap target to the Map: stepping past an edge again and again never leaves it', () => {
		const { surface, camera, flush, clock } = setup();
		clock.reduced = true;
		const { layout, rows } = realBoard();
		surface.resize(WIDTH, HEIGHT);
		surface.show(layout, rows, null);
		const { bounds } = layout.frame;
		camera.set({ ...camera.transform, k: camera.transform.k * 3 });
		flush();
		for (let i = 0; i < 6; i++) {
			const middle = centerOf(camera.transform, plot);
			surface.centerOn({ x: middle.x - (bounds.maxX - bounds.minX), y: middle.y }, false);
			flush();
			const now = centerOf(camera.transform, plot);
			expect(now.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
			expect(now.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
		}
		expect(centerOf(camera.transform, plot).x).toBeCloseTo(bounds.minX);
	});

	it('draws nothing as overlay while there is no layout', () => {
		const { surface, overlay, flush } = setup();
		surface.resize(WIDTH, HEIGHT);
		surface.clear();
		flush();
		expect(overlay.frame).toMatchObject({ cards: null, minimap: null, cardAlpha: 0 });
	});
});
