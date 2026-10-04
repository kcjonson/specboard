import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transform } from './camera';
import { SPRING_MS } from './drag';
import { FOCUS_FADE_MS } from './focus-fade';
import { HitIndex } from './hit-index';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { setup, WIDTH, HEIGHT } from './map-surface.fixture';
import { GESTURE_QUIET_MS } from './map-surface';

/**
 * Hover, focus, selection, the quick card, and dragging, driven through the surface with
 * a fake camera and renderer. Dots are found where the last frame drew them.
 */

interface Board {
	layout: ReturnType<typeof layoutMap>;
	rows: Map<string, ReturnType<BoardBuilder['add']>>;
	epic: string;
	/** The epic's children: a done one, one in flight, a ready one waiting on it, and one more waiting on that. */
	a: string;
	m: string;
	c: string;
	d: string;
	loose: string;
	other: string;
}

function board(): Board {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const a = b.add({ parentKey: epic.key, status: 'done' });
	const m = b.add({ parentKey: epic.key, status: 'in_progress' });
	b.block(m, a);
	const c = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(c, m);
	const d = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(d, c);
	const loose = b.add({ status: 'ready' });
	b.block(loose, a);
	const other = b.add({ status: 'ready' });
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	return { layout, rows: new Map(b.rows.map((row) => [row.key, row])), epic: epic.key, a: a.key, m: m.key, c: c.key, d: d.key, loose: loose.key, other: other.key };
}

/** A surface showing the board, settled: the camera has been still long enough that hover is live. */
function shown(): ReturnType<typeof setup> & Board & { at: (key: string) => { x: number; y: number }; step: (ms: number) => void; runDeferred: () => void } {
	const s = setup();
	const b = board();
	s.surface.resize(WIDTH, HEIGHT);
	s.surface.show(b.layout, b.rows, null);
	s.flush();
	s.clock.now = 1000;
	const at = (key: string): { x: number; y: number } => {
		const dot = s.renderer.frames.at(-1)!.dots.find((d) => d.key === key)!;
		const t = s.camera.transform;
		return { x: t.x + t.k * dot.x, y: t.y + t.k * dot.y };
	};
	return {
		...s,
		...b,
		at,
		step: (ms) => {
			s.clock.now += ms;
			s.flush();
		},
		runDeferred: () => s.deferred.splice(0).forEach((task) => task()),
	};
}

afterEach(() => vi.restoreAllMocks());

describe('hover', () => {
	it('lights the dot, its region, and its blocker chain, and fades the rest in 150 ms', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.flush();
		let frame = s.renderer.frames.at(-1)!;
		expect(frame.focus.to).toMatchObject({ key: s.m, region: false, outline: s.epic });
		expect(frame.focus.to!.dots.has(s.d)).toBe(true);
		expect(frame.focus.to!.dots.has(s.other)).toBe(false);
		expect(frame.focus.t).toBeLessThan(1);

		s.step(FOCUS_FADE_MS);
		frame = s.renderer.frames.at(-1)!;
		expect(frame.focus.t).toBe(1);
		expect(s.target).toHaveBeenLastCalledWith('item');
	});

	it('lights the whole family from a region, through its label', () => {
		const s = shown();
		const label = s.renderer.frames.at(-1)!.labels[0]!;
		s.surface.hoverAt({ x: label.box.x + 30, y: label.box.y + label.box.h / 2 });
		s.flush();
		expect(s.renderer.frames.at(-1)!.focus.to).toMatchObject({ key: s.epic, region: true });
	});

	it('clears when the pointer leaves, and the fade runs back', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.step(FOCUS_FADE_MS);
		s.surface.hoverAt(null);
		s.flush();
		expect(s.renderer.frames.at(-1)!.focus.to).toBeNull();
		expect(s.target).toHaveBeenLastCalledWith(null);
	});

	it('does not repaint when the pointer moves within the same dot', () => {
		const s = shown();
		const at = s.at(s.m);
		s.surface.hoverAt(at);
		s.step(FOCUS_FADE_MS);
		s.step(0);
		expect(s.frames).toHaveLength(0);
		s.surface.hoverAt({ x: at.x + 1, y: at.y });
		expect(s.frames).toHaveLength(0);
	});

	it('does not hit-test while the camera is moving, and looks at the pointer once it has been still', () => {
		const s = shown();
		const at = vi.spyOn(HitIndex.prototype, 'at');
		const t: Transform = s.camera.transform;
		// A pan in progress: the camera changed a few ms ago.
		s.camera.set({ ...t, x: t.x - 20 });
		s.clock.now += GESTURE_QUIET_MS / 4;
		const dot = s.at(s.m);
		s.surface.hoverAt(dot);
		s.surface.hoverAt({ x: dot.x + 2, y: dot.y });
		s.surface.hoverAt({ x: dot.x + 4, y: dot.y });
		expect(at).not.toHaveBeenCalled();
		expect(s.renderer.frames.at(-1)!.focus.to).toBeNull();

		// A deferred look is waiting; run once the camera has been still.
		s.clock.now += GESTURE_QUIET_MS * 2;
		s.flush();
		s.runDeferred();
		expect(at).toHaveBeenCalledTimes(1);
		s.flush();
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.m);
	});

	it('does not hit-test during a wheel pan or a zoom either: any camera change counts', () => {
		const s = shown();
		const at = vi.spyOn(HitIndex.prototype, 'at');
		for (let i = 0; i < 10; i++) {
			s.camera.set({ ...s.camera.transform, x: s.camera.transform.x - 5 });
			s.clock.now += 16;
			s.surface.hoverAt({ x: 400, y: 200 });
		}
		expect(at).not.toHaveBeenCalled();
	});

	it('opens the quick card after a beat, so sweeping across dots opens none', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.flush();
		expect(s.overlay.frame.quick).toBeNull();
		s.runDeferred();
		s.flush();
		expect(s.overlay.frame.quick).toMatchObject({ key: s.m });

		s.surface.hoverAt(s.at(s.other));
		s.flush();
		expect(s.overlay.frame.quick).toBeNull();
	});

	it('hover on a region shows the parent card, with its progress', () => {
		const s = shown();
		const label = s.renderer.frames.at(-1)!.labels[0]!;
		s.surface.hoverAt({ x: label.box.x + 30, y: label.box.y + label.box.h / 2 });
		s.runDeferred();
		s.flush();
		const quick = s.overlay.frame.quick!;
		expect(quick.key).toBe(s.epic);
		expect(quick.progress).toMatchObject({ done: 1 });
	});
});

describe('the quick card', () => {
	it('opens on the side that covers the fewest related items, inside the plot', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.runDeferred();
		s.flush();
		const quick = s.overlay.frame.quick!;
		expect(quick.x).toBeGreaterThanOrEqual(0);
		expect(quick.y).toBeGreaterThanOrEqual(0);
		expect(quick.x + 288).toBeLessThanOrEqual(WIDTH);
		expect(['right', 'left', 'above', 'below']).toContain(quick.side);
	});

	it('stays clear of the drawer', () => {
		const s = shown();
		s.surface.setCovered(400);
		s.surface.hoverAt(s.at(s.m));
		s.runDeferred();
		s.flush();
		expect(s.overlay.frame.quick!.x + 288).toBeLessThanOrEqual(WIDTH - 400);
	});

	it('opens at once for keyboard focus, and closes with it', () => {
		const s = shown();
		s.surface.setFocus(s.c);
		s.flush();
		expect(s.overlay.frame.quick).toMatchObject({ key: s.c });
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.c);
		s.surface.setFocus(null);
		s.flush();
		expect(s.overlay.frame.quick).toBeNull();
	});
});

describe('selection', () => {
	it('a click selects, holds the lit state after the pointer leaves, and asks for the drawer', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.surface.tap(s.surface.hitAt(s.at(s.m), false), false);
		expect(s.open).toHaveBeenCalledWith(s.m);
		expect(s.surface.selection).toBe(s.m);
		s.surface.hoverAt(null);
		s.step(FOCUS_FADE_MS);
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.m);
		// The drawer is showing it, so no card sits beside it.
		s.runDeferred();
		s.flush();
		expect(s.overlay.frame.quick).toBeNull();
	});

	it('a click on a region opens its parent', () => {
		const s = shown();
		const label = s.renderer.frames.at(-1)!.labels[0]!;
		const hit = s.surface.hitAt({ x: label.box.x + 30, y: label.box.y + label.box.h / 2 }, false);
		expect(hit).toEqual({ type: 'label', key: s.epic });
		s.surface.tap(hit, false);
		expect(s.open).toHaveBeenCalledWith(s.epic);
	});

	it('a click on a control collapses instead of selecting', () => {
		const s = shown();
		const label = s.renderer.frames.at(-1)!.labels[0]!;
		s.surface.tap(s.surface.hitAt(label.toggle, false), false);
		expect(s.collapse).toHaveBeenCalledWith(s.epic, true);
		expect(s.open).not.toHaveBeenCalled();
		expect(s.surface.selection).toBeNull();
	});

	it('is cleared by select(null), the second Escape', () => {
		const s = shown();
		s.surface.select(s.m);
		s.surface.select(null);
		s.step(FOCUS_FADE_MS);
		expect(s.renderer.frames.at(-1)!.focus.to).toBeNull();
	});

	it('survives a new layout of the same Map, relit against it', () => {
		const s = shown();
		s.surface.select(s.m);
		const next = board();
		s.surface.update(next.layout, next.rows);
		s.flush();
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.m);
	});

	it('Enter on the focused item selects it and asks for the drawer; with nothing focused it does nothing', () => {
		const s = shown();
		expect(s.surface.activateFocus()).toBeNull();
		s.surface.setFocus(s.c);
		expect(s.surface.activateFocus()).toBe(s.c);
		expect(s.open).toHaveBeenCalledWith(s.c);
		expect(s.surface.selection).toBe(s.c);
	});

	it('hover leads over keyboard focus, which leads over selection', () => {
		const s = shown();
		s.surface.select(s.a);
		s.surface.setFocus(s.c);
		s.step(FOCUS_FADE_MS);
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.c);
		s.surface.hoverAt(s.at(s.d));
		s.step(FOCUS_FADE_MS);
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.d);
		s.surface.hoverAt(null);
		s.surface.setFocus(null);
		s.step(FOCUS_FADE_MS);
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.a);
	});
});

describe('revealing the selection past the drawer', () => {
	it('pans just far enough to bring a dot hidden by the drawer into view', () => {
		const s = shown();
		s.surface.setCovered(380);
		const before = s.camera.transform;
		// Put the dot under the drawer.
		const target = s.at(s.m);
		s.camera.set({ ...before, x: before.x + (WIDTH - 100 - target.x) });
		s.camera.flights.length = 0;
		const hidden = s.at(s.m);
		s.surface.reveal(s.m);
		const flight = s.camera.flights.at(-1)!;
		const dot = s.renderer.frames.at(-1)!.dots.find((d) => d.key === s.m)!;
		const x = flight.x + flight.k * dot.x;
		expect(hidden.x).toBeGreaterThan(WIDTH - 380);
		expect(x).toBeLessThanOrEqual(WIDTH - 380);
		expect(x).toBeGreaterThan(WIDTH - 380 - 100);
		// Only horizontally: it was already in view vertically.
		expect(flight.y).toBeCloseTo(s.camera.transform.y);
	});

	it('does not move the camera when the dot is already clear', () => {
		const s = shown();
		s.surface.setCovered(100);
		s.camera.flights.length = 0;
		s.surface.reveal(s.other);
		const at = s.at(s.other);
		if (at.x < WIDTH - 100 - 56) expect(s.camera.flights).toHaveLength(0);
	});

	it('ignores an item the Map does not draw', () => {
		const s = shown();
		s.camera.flights.length = 0;
		s.surface.reveal('NOPE-1');
		expect(s.camera.flights).toHaveLength(0);
	});
});

describe('tapping on a coarse pointer', () => {
	it('selects and shows the card on the first tap, and opens the item on the second', () => {
		const s = shown();
		const hit = { type: 'dot', key: s.m, part: 'glyph' } as const;
		s.surface.tap(hit, true);
		s.flush();
		expect(s.open).not.toHaveBeenCalled();
		expect(s.surface.selection).toBe(s.m);
		expect(s.overlay.frame.quick).toMatchObject({ key: s.m });
		expect(s.renderer.frames.at(-1)!.focus.to?.key).toBe(s.m);

		s.surface.tap(hit, true);
		s.flush();
		expect(s.open).toHaveBeenCalledWith(s.m);
		// Opened: the drawer shows it, so the card steps aside.
		expect(s.overlay.frame.quick).toBeNull();
	});

	it('moves the selection to another dot on a tap, and shows that one\'s card', () => {
		const s = shown();
		s.surface.tap({ type: 'dot', key: s.m, part: 'glyph' }, true);
		s.surface.tap({ type: 'dot', key: s.c, part: 'glyph' }, true);
		s.flush();
		expect(s.open).not.toHaveBeenCalled();
		expect(s.overlay.frame.quick).toMatchObject({ key: s.c });
	});

	it('a tap on the empty plot lets go of a selection that has no drawer', () => {
		const s = shown();
		s.surface.tap({ type: 'dot', key: s.m, part: 'glyph' }, true);
		s.surface.tap(null, true);
		expect(s.surface.selection).toBeNull();
	});

	it('hit-tests with 44 px targets for a coarse pointer', () => {
		const s = shown();
		const at = s.at(s.other);
		expect(s.surface.hitAt({ x: at.x + 18, y: at.y }, true)).toMatchObject({ type: 'dot', key: s.other });
		expect(s.surface.hitAt({ x: at.x + 18, y: at.y }, false)?.key).not.toBe(s.other);
	});
});

describe('dragging a dot', () => {
	it('pulls the dot and its links along with the pointer, live, without re-running the layout', () => {
		const s = shown();
		const k = s.camera.transform.k;
		const home = s.at(s.m);
		const before = s.renderer.frames.at(-1)!.links.find((l) => l.ends.includes(s.m))!;
		s.surface.beginDrag(s.m, home);
		s.surface.dragTo({ x: home.x + 40, y: home.y - 20 });
		s.flush();
		const frame = s.renderer.frames.at(-1)!;
		expect(frame.drag).toEqual({ key: s.m, dx: 40 / k, dy: -20 / k });
		const moved = frame.links.find((l) => l.id === before.id)!;
		const end = moved.ends[0] === s.m ? 'from' : 'to';
		expect(moved[end].x).toBeCloseTo(before[end].x + 40 / k);
		expect(moved[end].y).toBeCloseTo(before[end].y - 20 / k);
		// The other end stays.
		const stay = end === 'from' ? 'to' : 'from';
		expect(moved[stay]).toEqual(before[stay]);
		// A link that doesn't touch it is untouched.
		const elsewhere = frame.links.filter((l) => !l.ends.includes(s.m));
		expect(elsewhere.every((l) => l === before || l.ends.every((end) => end !== s.m))).toBe(true);
		expect(s.surface.dragging).toBe(true);
	});

	it('hides the quick card while a dot is pulled', () => {
		const s = shown();
		s.surface.hoverAt(s.at(s.m));
		s.runDeferred();
		s.flush();
		expect(s.overlay.frame.quick).not.toBeNull();
		s.surface.beginDrag(s.m, s.at(s.m));
		s.flush();
		expect(s.overlay.frame.quick).toBeNull();
		expect(s.overlay.frame.drag).toMatchObject({ key: s.m });
	});

	it('springs back on release over about 300 ms, passing home on the way, and saves nothing', () => {
		const s = shown();
		const home = s.at(s.m);
		s.surface.beginDrag(s.m, home);
		s.surface.dragTo({ x: home.x + 60, y: home.y });
		s.flush();
		const pulled = s.renderer.frames.at(-1)!.drag!.dx;
		s.surface.endDrag();

		const offsets: number[] = [];
		for (let t = 0; t < SPRING_MS + 60; t += 20) {
			s.step(t === 0 ? 0 : 20);
			offsets.push(s.renderer.frames.at(-1)!.drag?.dx ?? 0);
		}
		expect(Math.abs(offsets[0]!)).toBeCloseTo(Math.abs(pulled), 0);
		// It crosses home and overshoots a little before settling.
		expect(offsets.some((dx) => dx * pulled < 0)).toBe(true);
		// Home by the end: no drag in the frame, and the dot is where the layout put it.
		expect(s.renderer.frames.at(-1)!.drag).toBeNull();
		expect(s.surface.dragging).toBe(false);
		expect(s.at(s.m)).toEqual(home);
	});

	it('is home at once under reduced motion', () => {
		const s = shown();
		s.clock.reduced = true;
		const home = s.at(s.m);
		s.surface.beginDrag(s.m, home);
		s.surface.dragTo({ x: home.x + 60, y: home.y });
		s.surface.endDrag();
		s.flush();
		expect(s.renderer.frames.at(-1)!.drag).toBeNull();
		expect(s.surface.dragging).toBe(false);
	});

	it('is not hovered away from while it is held, and ignores a drag of something that is not a dot', () => {
		const s = shown();
		s.surface.beginDrag('NOPE-1', { x: 0, y: 0 });
		expect(s.surface.dragging).toBe(false);
		const at = vi.spyOn(HitIndex.prototype, 'at');
		s.surface.beginDrag(s.m, s.at(s.m));
		s.surface.hoverAt(s.at(s.other));
		expect(at).not.toHaveBeenCalled();
	});
});

describe('All links', () => {
	it('is handed to the renderer, which draws every blocker and discovered-from link', () => {
		const s = shown();
		expect(s.renderer.frames.at(-1)!.allLinks).toBe(false);
		s.surface.setAllLinks(true);
		s.flush();
		expect(s.renderer.frames.at(-1)!.allLinks).toBe(true);
	});

	it('keeps satisfied blockers in the links it draws, and not one removed by hand', () => {
		const s = shown();
		const { links } = s.renderer.frames.at(-1)!;
		// a is done, so m's wait on it is satisfied and still drawn; `other` has no links at all.
		expect(links.find((l) => l.id.endsWith(`${s.a}>${s.m}`))?.satisfied).toBe(true);
		expect(links.some((l) => l.ends.includes(s.other))).toBe(false);
	});
});
