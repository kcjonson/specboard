import { describe, expect, it } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { BoardBuilder, NOW, iso } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import { setup, WIDTH, HEIGHT } from './map-surface.fixture';
import { GESTURE_QUIET_MS } from './map-surface';
import { diffRows, type MapUpdate } from './map-update';
import { ENTER_MS, EXIT_MS, GLIDE_MS } from './motion';
import { HIGHLIGHT_DURATION } from '../utils/highlight';

/**
 * A refresh landing on the surface: it moves to the new layout in a transition, and keeps
 * what the person has (the camera, the selection, focus, hover, the lit search) as it was.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LATER = NOW + 10_000;

interface Refresh {
	before: { layout: MapLayout; rows: Map<string, MapItemRow> };
	after: { layout: MapLayout; rows: Map<string, MapItemRow> };
	changes: MapUpdate;
	/** Picked up by the refresh: it moves toward now. */
	picked: string;
	/** Nothing happened to it. */
	still: string;
}

function refresh(): Refresh {
	const b = new BoardBuilder();
	for (let i = 0; i < 4; i++) b.add({ status: 'done', created: NOW - 9 * DAY, completed: NOW - (6 - i) * DAY });
	b.add({ status: 'in_progress', started: NOW - HOUR });
	const picked = b.add({ status: 'ready', created: NOW - 5 * DAY });
	const still = b.add({ status: 'ready', created: NOW - 4 * DAY });
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: NOW, collapse: {}, aspect: WIDTH / 500 });
	const next = b.rows.map((row) => (row.key === picked.key ? { ...row, status: 'in_progress' as const, startedAt: iso(LATER), timeAnchor: iso(LATER) } : row));
	const nextRows = new Map(next.map((row) => [row.key, row]));
	const changes = diffRows(rows, nextRows);
	const after = layoutMap({
		rows: next,
		now: LATER,
		collapse: {},
		aspect: WIDTH / 500,
		previous: { frame: layout.frame, positions: Object.fromEntries(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }])), changed: [...changes.moved] },
	});
	return { before: { layout, rows }, after: { layout: after, rows: nextRows }, changes, picked: picked.key, still: still.key };
}

function shown(): ReturnType<typeof setup> & Refresh & {
	dot: (key: string) => { x: number; y: number };
	screen: (key: string) => { x: number; y: number };
	step: (ms: number) => void;
} {
	const s = setup();
	const r = refresh();
	s.surface.resize(WIDTH, HEIGHT);
	s.surface.show(r.before.layout, r.before.rows, null);
	s.flush();
	s.clock.now = 1000;
	const dot = (key: string): { x: number; y: number } => s.renderer.frames.at(-1)!.dots.find((d) => d.key === key)!;
	const screen = (key: string): { x: number; y: number } => {
		const { x, y } = dot(key);
		const t = s.camera.transform;
		return { x: t.x + t.k * x, y: t.y + t.k * y };
	};
	return { ...s, ...r, dot, screen, step: (ms) => { s.clock.now += ms; s.flush(); } };
}

describe('a refresh on the surface', () => {
	it('glides what moved from where it was drawn, and asks for frames only until it lands', () => {
		const s = shown();
		const from = s.dot(s.picked);
		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.flush();
		expect(s.dot(s.picked).x).toBeCloseTo(from.x, 6);

		s.step(GLIDE_MS / 2);
		const mid = s.dot(s.picked).x;
		expect(mid).toBeGreaterThan(from.x);

		s.step(GLIDE_MS / 2 + ENTER_MS + EXIT_MS);
		const to = s.after.layout.nodes.find((n) => n.key === s.picked)!;
		expect(s.dot(s.picked)).toMatchObject({ x: to.x, y: to.y });
		expect(s.renderer.frames.at(-1)!.effects?.size ?? 0).toBe(0);
		expect(s.frames).toHaveLength(0);
	});

	it('never resets the viewport, the selection, focus, or what a search lit', () => {
		const s = shown();
		s.camera.set({ k: 1.7, x: -120, y: 40 });
		s.surface.select(s.still);
		s.surface.setFocus(s.still);
		const highlight = { dots: new Set([s.still]), regions: new Set<string>(), outlined: new Set<string>() };
		s.surface.setHighlight(highlight);
		s.step(GESTURE_QUIET_MS);
		const camera = s.camera.transform;
		const onScreen = s.screen(s.still);

		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.step(GLIDE_MS + 1);

		// The camera only ever follows the focused dot, by however far it moved: the zoom and its place on screen hold.
		expect(s.camera.transform.k).toBe(camera.k);
		expect(s.screen(s.still).x).toBeCloseTo(onScreen.x, 4);
		expect(s.screen(s.still).y).toBeCloseTo(onScreen.y, 4);
		expect(s.surface.selection).toBe(s.still);
		const frame = s.renderer.frames.at(-1)!;
		expect(frame.focus.to!.key).toBe(s.still);
		expect(frame.focus.to!.dots.has(s.still)).toBe(true);
	});

	it('leaves the camera alone when nothing is focused or selected', () => {
		const s = shown();
		s.camera.set({ k: 1.7, x: -120, y: 40 });
		s.step(GESTURE_QUIET_MS);
		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.step(GLIDE_MS + 1);
		expect(s.camera.transform).toEqual({ k: 1.7, x: -120, y: 40 });
		expect(s.camera.pans).toHaveLength(0);
	});

	it('keeps the dot under the pointer under it, and glides it home once the pointer leaves', () => {
		const s = shown();
		s.step(GESTURE_QUIET_MS);
		const pointer = s.screen(s.picked);
		s.surface.hoverAt(pointer);
		s.flush();
		const held = s.dot(s.picked);

		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.step(GLIDE_MS * 3);
		expect(s.dot(s.picked)).toMatchObject({ x: held.x, y: held.y });
		expect(s.frames).toHaveLength(0);

		s.surface.hoverAt(null);
		s.step(GLIDE_MS / 2);
		expect(s.dot(s.picked).x).toBeGreaterThan(held.x);
		s.step(GLIDE_MS);
		expect(s.dot(s.picked).x).toBe(s.after.layout.nodes.find((n) => n.key === s.picked)!.x);
	});

	it('moves the camera with a focused dot that glides, so it keeps its place on screen', () => {
		const s = shown();
		s.surface.setFocus(s.picked);
		s.step(GESTURE_QUIET_MS);
		const before = s.screen(s.picked);

		s.surface.update(s.after.layout, s.after.rows, s.changes);
		for (let t = 0; t < GLIDE_MS + 100; t += 50) {
			s.step(50);
			expect(s.screen(s.picked).x).toBeCloseTo(before.x, 4);
			expect(s.screen(s.picked).y).toBeCloseTo(before.y, 4);
		}
		expect(s.camera.pans.length).toBeGreaterThan(5);
	});

	it('lets a flight the person asked for win over the follow', () => {
		const s = shown();
		s.surface.setFocus(s.picked);
		s.step(GESTURE_QUIET_MS);
		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.step(50);
		const pans = s.camera.pans.length;
		s.camera.flying = true;
		s.step(50);
		s.camera.flying = false;
		s.step(GLIDE_MS);
		expect(s.camera.pans).toHaveLength(pans);
	});

	it('cuts a collapse, which brings no changes, straight to the new layout', () => {
		const s = shown();
		s.surface.update(s.after.layout, s.after.rows, null);
		s.flush();
		expect(s.dot(s.picked).x).toBe(s.after.layout.nodes.find((n) => n.key === s.picked)!.x);
		expect(s.frames).toHaveLength(0);
	});

	it('cuts under reduced motion, with the 2 s highlight on what changed and nothing else moving', () => {
		const s = shown();
		s.clock.reduced = true;
		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.flush();
		const frame = s.renderer.frames.at(-1)!;
		expect(s.dot(s.picked).x).toBe(s.after.layout.nodes.find((n) => n.key === s.picked)!.x);
		expect(frame.effects!.get(s.picked)).toMatchObject({ highlight: true, ping: null, sweep: null });
		expect(frame.effects!.has(s.still)).toBe(false);
		expect(frame.fading).toBeNull();

		s.step(HIGHLIGHT_DURATION);
		expect(s.renderer.frames.at(-1)!.effects?.size ?? 0).toBe(0);
	});

	it('starts a refresh that lands mid-glide from where the dots are drawn, not from where they were headed', () => {
		const s = shown();
		s.surface.update(s.after.layout, s.after.rows, s.changes);
		s.step(GLIDE_MS / 2);
		const mid = s.dot(s.picked);
		s.surface.update(s.after.layout, s.after.rows, { ...s.changes, wrote: new Set() });
		s.flush();
		expect(s.dot(s.picked).x).toBeCloseTo(mid.x, 6);
	});
});
