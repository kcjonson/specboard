import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import { highlightOf } from './map-lens';
import { setup, HEIGHT, WIDTH } from './map-surface.fixture';

interface Scene {
	layout: MapLayout;
	rows: Map<string, ReturnType<BoardBuilder['add']>>;
	keys: string[];
	epic: string;
	inEpic: string;
	upNext: string;
}

function scene(): Scene {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const inEpic = b.add({ parentKey: epic.key, status: 'in_progress' });
	b.add({ parentKey: epic.key, status: 'done' });
	const keys: string[] = [inEpic.key];
	for (let i = 0; i < 10; i++) keys.push(b.add({ status: i < 5 ? 'done' : 'ready', created: b.now - (40 - i * 4) * 86_400_000 }).key);
	const upNext = b.add({ parentKey: epic.key, status: 'ready' });
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	return { layout, rows: new Map(b.rows.map((row) => [row.key, row])), keys, epic: epic.key, inEpic: inEpic.key, upNext: upNext.key };
}

function shown(): ReturnType<typeof setup> & { s: Scene } {
	const rig = setup();
	const s = scene();
	rig.surface.resize(WIDTH, HEIGHT);
	rig.surface.show(s.layout, s.rows, null);
	rig.flush();
	return { ...rig, s };
}

describe('MapSurface under a search or filter', () => {
	it('lights only what the lens lit, fades the rest through the focus mechanism, and moves nothing', () => {
		const { surface, renderer, flush, s } = shown();
		const before = JSON.stringify(renderer.frames.at(-1)!.dots.map((dot) => [dot.key, dot.x, dot.y]));
		expect(renderer.frames.at(-1)!.focus.to).toBeNull();

		surface.setHighlight(highlightOf([s.keys[3]!], s.layout));
		flush();
		const frame = renderer.frames.at(-1)!;
		expect(frame.focus.to!.dots).toEqual(new Set([s.keys[3]]));
		expect(frame.focus.to!.key).toBe('');
		expect(JSON.stringify(frame.dots.map((dot) => [dot.key, dot.x, dot.y]))).toBe(before);
	});

	it('puts everything back with a null highlight', () => {
		const { surface, renderer, flush, s } = shown();
		surface.setHighlight(highlightOf([s.keys[3]!], s.layout));
		flush();
		surface.setHighlight(null);
		flush();
		expect(renderer.frames.at(-1)!.focus.to).toBeNull();
		expect(renderer.frames.at(-1)!.outlined.size).toBe(0);
	});

	it('hands the renderer the regions to outline, and labels for the matches', () => {
		const { surface, renderer, flush, s } = shown();
		surface.setHighlight(highlightOf([s.epic, s.keys[8]!], s.layout));
		flush();
		const frame = renderer.frames.at(-1)!;
		expect(frame.outlined).toEqual(new Set([s.epic]));
		expect(frame.dotLabels.map((label) => label.key)).toContain(s.keys[8]);
	});

	it('keeps what the lens lit lit while something else is hovered or focused, and adds the hovered family', () => {
		const { surface, renderer, flush, s } = shown();
		surface.setHighlight(highlightOf([s.keys[3]!], s.layout));
		surface.setFocus(s.keys[8]!);
		flush();
		const lit = renderer.frames.at(-1)!.focus.to!;
		expect(lit.dots.has(s.keys[3]!)).toBe(true);
		expect(lit.dots.has(s.keys[8]!)).toBe(true);
		expect(lit.key).toBe(s.keys[8]);
	});

	it('does not restart the fade for a highlight it already has', () => {
		const { surface, renderer, flush, s } = shown();
		const highlight = highlightOf([s.keys[3]!], s.layout);
		surface.setHighlight(highlight);
		flush();
		const target = renderer.frames.at(-1)!.focus.to;
		surface.setHighlight(highlight);
		surface.setFocus(null);
		flush();
		expect(renderer.frames.at(-1)!.focus.to).toBe(target);
	});
});

describe('MapSurface edge markers', () => {
	const zoomedAway = { k: 6, x: 0, y: 0 };

	it('marks an asked-for item that is out of view, and not one that is in it', () => {
		const { surface, camera, overlay, flush, s } = shown();
		surface.setEdgeMarkers([{ key: s.upNext, kind: 'up-next', text: '1' }]);
		flush();
		// At fit all everything is on screen.
		expect(overlay.frame.edges).toEqual([]);
		camera.set(zoomedAway);
		flush();
		expect(overlay.frame.edges).toHaveLength(1);
		const [marker] = overlay.frame.edges;
		expect(marker).toMatchObject({ key: s.upNext, kind: 'up-next', text: '1' });
		expect(marker!.x).toBeGreaterThanOrEqual(0);
		expect(marker!.x).toBeLessThanOrEqual(WIDTH);
		expect(marker!.y).toBeLessThanOrEqual(HEIGHT);
	});

	it('keeps the markers off the toolbar and out from under the drawer', () => {
		const { surface, camera, overlay, flush, s } = shown();
		surface.setEdgeMarkers([{ key: s.upNext, kind: 'up-next', text: '1' }]);
		camera.set(zoomedAway);
		flush();
		const free = overlay.frame.edges[0]!;
		surface.setChrome([{ x: free.x - 40, y: free.y - 40, w: 80, h: 80 }]);
		flush();
		const [moved] = overlay.frame.edges;
		expect(moved).toBeDefined();
		expect(Math.hypot(moved!.x - free.x, moved!.y - free.y)).toBeGreaterThan(20);
		surface.setChrome([]);
		surface.setCovered(300);
		flush();
		expect(overlay.frame.edges[0]!.x).toBeLessThanOrEqual(WIDTH - 300);
	});

	it('keeps the markers off the labels the canvas drew', () => {
		const { surface, camera, overlay, renderer, flush, s } = shown();
		surface.setEdgeMarkers([{ key: s.upNext, kind: 'up-next', text: '1' }]);
		for (const k of [3, 4, 5, 6, 8]) {
			camera.set({ k, x: -20 * k, y: -10 * k });
			flush();
			const frame = renderer.frames.at(-1)!;
			const boxes = [...frame.labels.map((label) => label.box), ...frame.dotLabels.map((label) => label.box)];
			for (const marker of overlay.frame.edges) {
				const box = { x: marker.x - 13, y: marker.y - 13, w: 26, h: 26 };
				for (const label of boxes) {
					expect(box.x < label.x + label.w && box.x + box.w > label.x && box.y < label.y + label.h && box.y + box.h > label.y).toBe(false);
				}
			}
		}
	});

	it('draws none for an empty list, or after the Map clears', () => {
		const { surface, camera, overlay, flush, s } = shown();
		surface.setEdgeMarkers([{ key: s.upNext, kind: 'up-next' }]);
		camera.set(zoomedAway);
		flush();
		expect(overlay.frame.edges).toHaveLength(1);
		surface.setEdgeMarkers([]);
		flush();
		expect(overlay.frame.edges).toEqual([]);
		surface.setEdgeMarkers([{ key: s.upNext, kind: 'up-next' }]);
		surface.clear();
		flush();
		expect(overlay.frame.edges).toEqual([]);
	});
});
