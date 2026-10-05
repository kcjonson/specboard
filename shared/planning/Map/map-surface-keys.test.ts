import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { pickInDirection } from './map-nav';
import { setup, WIDTH, HEIGHT } from './map-surface.fixture';

/**
 * The keyboard layer on the surface: arrows to the nearest dot or region label, Enter, P and
 * L through what needs a person and the live sessions, F, the zoom keys' anchor, and the
 * tree keys. Driven through a fake camera and renderer, with dots found where the last frame
 * drew them.
 */

function board(): { b: BoardBuilder; layout: ReturnType<typeof layoutMap>; rows: Map<string, ReturnType<BoardBuilder['add']>>; keys: Record<string, string> } {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress', title: 'Search' });
	const live = b.add({ parentKey: epic.key, status: 'in_progress', title: 'Index it' });
	const quiet = b.add({ parentKey: epic.key, status: 'in_progress', title: 'Draw it' });
	b.add({ parentKey: epic.key, status: 'done' });
	const question = b.add({ status: 'ready', subStatus: 'needs_input', title: 'Which index?' });
	const hold = b.add({ status: 'ready', textBlockerCount: 1, blocked: true, title: 'Waiting on legal' });
	const free = b.add({ status: 'ready', title: 'Loose end' });
	const done = b.add({ type: 'epic', status: 'done', title: 'Old epic' });
	b.add({ parentKey: done.key, status: 'done' });
	b.work(live, 'live-session', 'laptop', 2);
	b.work(quiet, 'quiet-session', 'laptop', 30);
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	const keys = { epic: epic.key, live: live.key, quiet: quiet.key, question: question.key, hold: hold.key, free: free.key, done: done.key };
	return { b, layout, rows: new Map(b.rows.map((row) => [row.key, row])), keys };
}

function shown(): ReturnType<typeof setup> & ReturnType<typeof board> & { at: (key: string) => { x: number; y: number }; frame: () => ReturnType<typeof setup>['renderer']['frames'][number] } {
	const s = setup();
	const bd = board();
	s.surface.resize(WIDTH, HEIGHT);
	s.surface.setNow(bd.b.now);
	s.surface.show(bd.layout, bd.rows, null);
	s.flush();
	s.clock.now = 1000;
	const frame = (): ReturnType<typeof setup>['renderer']['frames'][number] => s.renderer.frames.at(-1)!;
	const at = (key: string): { x: number; y: number } => {
		const t = s.camera.transform;
		const dot = frame().dots.find((d) => d.key === key)!;
		return { x: t.x + t.k * dot.x, y: t.y + t.k * dot.y };
	};
	return { ...s, ...bd, at, frame };
}

describe('arrow keys', () => {
	it('land on the dot nearest the middle when nothing is focused, whichever arrow it was, and pan nowhere', () => {
		const s = shown();
		const flights = s.camera.flights.length;
		const key = s.surface.moveFocus('left');
		expect(key).not.toBeNull();
		expect(s.surface.focus).toBe(key);
		expect(s.focus).toHaveBeenLastCalledWith(key);
		expect(s.camera.flights.length).toBe(flights);
	});

	it('move to the nearest dot in that direction, as the cone picks it from where the last frame drew them', () => {
		const s = shown();
		const start = s.surface.moveFocus('right')!;
		s.flush();
		const from = s.at(start);
		const targets = s.frame().dots.map((dot) => ({ key: dot.key, ...s.at(dot.key) }));
		for (const direction of ['right', 'left', 'up', 'down'] as const) {
			const expected = pickInDirection(from, targets, direction, start);
			s.surface.setFocus(start);
			s.flush();
			const moved = s.surface.moveFocus(direction);
			// A dot or a region's label, whichever the cone found; with a label standing in, it is the label's key.
			if (expected && s.frame().labels.every((label) => label.key !== moved)) expect(moved).toBe(expected.key);
			if (!expected) expect(moved).toBe(start);
		}
	});

	it('stop at the edge: past the last dot in a direction focus stays put', () => {
		const s = shown();
		let key = s.surface.moveFocus('left')!;
		for (let i = 0; i < 40; i++) {
			s.flush();
			const next = s.surface.moveFocus('right')!;
			if (next === key) break;
			key = next;
		}
		s.flush();
		expect(s.surface.moveFocus('right')).toBe(key);
		expect(s.surface.focus).toBe(key);
	});

	it('reach a region by its label: Up from a child lands on the parent', () => {
		const s = setup();
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const a = b.add({ parentKey: epic.key, status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'ready' });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		s.surface.resize(WIDTH, HEIGHT);
		s.surface.show(layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 }), rows, null);
		s.flush();
		expect(s.renderer.frames.at(-1)!.labels.map((label) => label.key)).toContain(epic.key);
		s.surface.setFocus(a.key);
		s.flush();
		let reached = false;
		for (const direction of ['up', 'left', 'right', 'down'] as const) {
			s.surface.setFocus(a.key);
			if (s.surface.moveFocus(direction) === epic.key) reached = true;
		}
		expect(reached).toBe(true);
	});

	it('pan just far enough to keep a focused dot in view, and not at all while it is', () => {
		const s = shown();
		const start = s.surface.moveFocus('right')!;
		s.flush();
		const flights = s.camera.flights.length;
		s.surface.moveFocus('left');
		s.flush();
		expect(s.camera.flights.length).toBe(flights);
		// Zoomed in until the neighbors are off the plot, the same move has to bring the next dot into view.
		s.camera.set({ k: 12, x: -12 * (s.frame().dots.find((d) => d.key === start)!.x) + WIDTH / 2, y: -12 * s.frame().dots.find((d) => d.key === start)!.y + 250 });
		s.flush();
		s.surface.setFocus(start);
		const before = s.camera.flights.length;
		const moved = s.surface.moveFocus('up') ?? s.surface.moveFocus('down');
		expect(moved).not.toBeNull();
		expect(s.camera.flights.length).toBeGreaterThan(before);
	});
});

describe('Enter', () => {
	it('opens the focused item, and the region\'s parent when focus is on its label', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		expect(s.surface.activateFocus()).toBe(s.keys.free);
		expect(s.open).toHaveBeenLastCalledWith(s.keys.free);
		s.surface.setFocus(s.keys.epic!);
		expect(s.surface.activateFocus()).toBe(s.keys.epic);
		expect(s.open).toHaveBeenLastCalledWith(s.keys.epic);
	});

	it('holds a focused session lit instead, since it has no drawer, and lets go on the second press', () => {
		const s = shown();
		const session = s.frame().agents.find((agent) => agent.kind === 'session')!.key;
		s.surface.setFocus(session);
		s.open.mockClear();
		expect(s.surface.activateFocus()).toBe(session);
		expect(s.surface.selection).toBe(session);
		s.surface.activateFocus();
		expect(s.surface.selection).toBeNull();
		expect(s.open).not.toHaveBeenCalled();
	});
});

describe('P and L', () => {
	it('step through what needs a person in reading order, wrapping, and fly there', () => {
		const s = shown();
		const needs = [...s.frame().dots.filter((dot) => dot.reason !== null)].sort((a, b) => a.x - b.x || a.y - b.y).map((dot) => dot.key);
		expect(needs.length).toBeGreaterThanOrEqual(2);
		const flights = s.camera.flights.length;
		expect(s.surface.stepNeedsPerson(1)).toBe(needs[0]);
		expect(s.camera.flights.length).toBe(flights + 1);
		expect(s.surface.focus).toBe(needs[0]);
		expect(s.surface.stepNeedsPerson(1)).toBe(needs[1]);
		expect(s.surface.stepNeedsPerson(-1)).toBe(needs[0]);
		expect(s.surface.stepNeedsPerson(-1)).toBe(needs.at(-1));
		expect(s.surface.stepNeedsPerson(1)).toBe(needs[0]);
	});

	it('Shift+P with nothing yet focused starts from the last', () => {
		const s = shown();
		const needs = [...s.frame().dots.filter((dot) => dot.reason !== null)].sort((a, b) => a.x - b.x || a.y - b.y).map((dot) => dot.key);
		expect(s.surface.stepNeedsPerson(-1)).toBe(needs.at(-1));
	});

	it('step through live sessions only, a quiet one left out', () => {
		const s = shown();
		const live = s.frame().agents.filter((agent) => agent.kind === 'session' && agent.state === 'live').map((agent) => agent.key);
		expect(live).toHaveLength(1);
		expect(s.surface.stepLiveSession(1)).toBe(live[0]);
		expect(s.surface.stepLiveSession(1)).toBe(live[0]);
		expect(s.surface.stepLiveSession(-1)).toBe(live[0]);
	});

	it('do nothing, and say null, when there is nothing to step through', () => {
		const s = setup();
		const b = new BoardBuilder();
		b.add({ status: 'ready' });
		s.surface.resize(WIDTH, HEIGHT);
		s.surface.show(layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 }), new Map(b.rows.map((row) => [row.key, row])), null);
		s.flush();
		expect(s.surface.stepNeedsPerson(1)).toBeNull();
		expect(s.surface.stepLiveSession(1)).toBeNull();
		expect(s.surface.focus).toBeNull();
	});
});

describe('F', () => {
	it('fits a focused dot\'s whole family into the plot', () => {
		const s = shown();
		s.surface.setFocus(s.keys.live!);
		const flights = s.camera.flights.length;
		expect(s.surface.fitFamily()).toBe(s.keys.live);
		expect(s.camera.flights.length).toBe(flights + 1);
		const { k, x, y } = s.camera.transform;
		const family = [s.keys.live!, s.keys.quiet!];
		for (const key of family) {
			const dot = s.frame().dots.find((d) => d.key === key)!;
			expect(x + k * dot.x).toBeGreaterThan(0);
			expect(x + k * dot.x).toBeLessThan(WIDTH);
			expect(y + k * dot.y).toBeGreaterThan(0);
			expect(y + k * dot.y).toBeLessThan(HEIGHT);
		}
	});

	it('fits a region from its label the same way', () => {
		const s = shown();
		s.surface.setFocus(s.keys.epic!);
		const flights = s.camera.flights.length;
		expect(s.surface.fitFamily()).toBe(s.keys.epic);
		expect(s.camera.flights.length).toBe(flights + 1);
	});

	it('flies to a loose dot, which has no family', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		const flights = s.camera.flights.length;
		expect(s.surface.fitFamily()).toBe(s.keys.free);
		expect(s.camera.flights.length).toBe(flights + 1);
	});

	it('falls back to the selection with nothing focused, and does nothing with neither', () => {
		const s = shown();
		const flights = s.camera.flights.length;
		expect(s.surface.fitFamily()).toBeNull();
		expect(s.camera.flights.length).toBe(flights);
		s.surface.select(s.keys.free!);
		expect(s.surface.fitFamily()).toBe(s.keys.free);
	});

	it('leaves room for the drawer', () => {
		const s = shown();
		s.surface.setCovered(400);
		s.surface.setFocus(s.keys.epic!);
		s.surface.fitFamily();
		const { k, x } = s.camera.transform;
		for (const key of [s.keys.live!, s.keys.quiet!]) {
			const dot = s.frame().dots.find((d) => d.key === key)!;
			expect(x + k * dot.x).toBeLessThan(WIDTH - 400);
		}
	});
});

describe('+ and -', () => {
	it('zoom around the focused dot, which holds still on screen', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		s.surface.zoomInAtFocus();
		expect(s.camera.zooms.at(-1)?.around).toEqual(s.at(s.keys.free!));
		s.surface.zoomOutAtFocus();
		expect(s.camera.zooms.at(-1)?.factor).toBeLessThan(1);
		expect(s.camera.zooms.at(-1)?.around).toEqual(s.at(s.keys.free!));
	});

	it('zoom around the middle of the plot with nothing focused, or the focus out of view', () => {
		const s = shown();
		s.surface.zoomInAtFocus();
		expect(s.camera.zooms.at(-1)?.around).toBeUndefined();
		s.surface.setFocus(s.keys.free!);
		s.camera.set({ k: 1, x: -5000, y: -5000 });
		s.surface.zoomInAtFocus();
		expect(s.camera.zooms.at(-1)?.around).toBeUndefined();
	});

	it('leave Z on the pointer, as before', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		s.surface.hoverAt({ x: 100, y: 120 });
		s.surface.zoomInByKey();
		expect(s.camera.zooms.at(-1)?.around).toEqual({ x: 100, y: 120 });
	});
});

describe('tree keys', () => {
	it('Shift+Left collapses a focused region', () => {
		const s = shown();
		s.surface.setFocus(s.keys.epic!);
		s.surface.collapseFocus();
		expect(s.collapse).toHaveBeenLastCalledWith(s.keys.epic, true);
	});

	it('Shift+Left on a dot goes up to the region it sits in, and on a loose dot does nothing', () => {
		const s = shown();
		s.surface.setFocus(s.keys.live!);
		s.surface.collapseFocus();
		expect(s.surface.focus).toBe(s.keys.epic);
		expect(s.collapse).not.toHaveBeenCalled();
		s.surface.setFocus(s.keys.free!);
		s.surface.collapseFocus();
		expect(s.surface.focus).toBe(s.keys.free);
	});

	it('Shift+Right expands a folded family', () => {
		const s = shown();
		s.surface.setFocus(s.keys.done!);
		s.surface.expandFocus();
		expect(s.collapse).toHaveBeenLastCalledWith(s.keys.done, false);
	});

	it('Shift+Right on a region goes down to its leftmost dot', () => {
		const s = shown();
		s.surface.setFocus(s.keys.epic!);
		s.surface.expandFocus();
		const members = s.layout.regions.find((region) => region.key === s.keys.epic)!.members;
		const leftmost = s.frame().dots.filter((dot) => members.includes(dot.key)).sort((a, b) => a.x - b.x || a.y - b.y)[0]!;
		expect(s.surface.focus).toBe(leftmost.key);
	});
});

describe('focus that goes stale', () => {
	it('is dropped when a refresh takes its item away, and the tree hears of it', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		const rows = new Map(s.rows);
		rows.delete(s.keys.free!);
		s.surface.update(layoutMap({ rows: [...rows.values()], now: s.b.now, collapse: {}, aspect: WIDTH / 500 }), rows);
		expect(s.surface.focus).toBeNull();
		expect(s.focus).toHaveBeenLastCalledWith(null);
	});

	it('is dropped when the Map clears for a reload', () => {
		const s = shown();
		s.surface.setFocus(s.keys.free!);
		s.surface.clear();
		expect(s.surface.focus).toBeNull();
	});
});
