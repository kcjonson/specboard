import { describe, expect, it } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { buildDrawList, type DrawDot } from './draw-list';
import { BoardBuilder, NOW, iso } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import { diffRows } from './map-update';
import { ENTER_MS, EXIT_MS, GLIDE_MS, PING_MS, SWEEP_MS, Transition, type TransitionInput } from './motion';
import { HIGHLIGHT_DURATION } from '../utils/highlight';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LATER = NOW + 10_000;
/** When the refresh lands on the page's clock. */
const T0 = 50_000;

const copy = (rows: readonly MapItemRow[]): MapItemRow[] => rows.map((row) => ({ ...row, workers: [...row.workers], blockers: [...row.blockers] }));

/** A layout before, a local pass after the edit, and a transition between them, the way a refresh lands. */
function scene(before: MapItemRow[], edit: (rows: MapItemRow[]) => MapItemRow[], options: Partial<TransitionInput> = {}): {
	transition: Transition;
	a: MapLayout;
	b: MapLayout;
	from: Map<string, DrawDot>;
	to: Map<string, DrawDot>;
} {
	const rowsA = new Map(before.map((row) => [row.key, row]));
	const a = layoutMap({ rows: before, now: NOW, collapse: {}, aspect: 2, outlineSteps: [5] });
	const after = edit(copy(before));
	const rowsB = new Map(after.map((row) => [row.key, row]));
	const changes = diffRows(rowsA, rowsB);
	const b = layoutMap({
		rows: after,
		now: LATER,
		collapse: {},
		aspect: 2,
		outlineSteps: [5],
		previous: { frame: a.frame, positions: Object.fromEntries(a.nodes.map((n) => [n.key, { x: n.x, y: n.y }])), changed: [...changes.added, ...changes.moved] },
	});
	const drawnA = buildDrawList(a, rowsA, NOW);
	const drawnB = buildDrawList(b, rowsB, LATER);
	const transition = new Transition({
		now: T0,
		reduced: false,
		from: { dots: new Map(drawnA.dots.map((d) => [d.key, d])), agents: new Map(drawnA.agents.map((d) => [d.key, d])), outlines: a.outlines[0]!.regions },
		to: drawnB,
		layout: b,
		outlines: b.outlines[0]!.regions,
		changes,
		held: null,
		follow: null,
		...options,
	});
	return { transition, a, b, from: new Map(drawnA.dots.map((d) => [d.key, d])), to: new Map(drawnB.dots.map((d) => [d.key, d])) };
}

/** A small live board: done work back in time, an epic with open children, and loose ready items. */
function board(): { b: BoardBuilder; epic: MapItemRow; children: MapItemRow[]; loose: MapItemRow[]; done: MapItemRow[] } {
	const b = new BoardBuilder();
	const done = Array.from({ length: 4 }, (_, i) => b.add({ status: 'done', created: NOW - 9 * DAY, completed: NOW - (6 - i) * DAY }));
	const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 8 * DAY, started: NOW - 5 * DAY });
	const children = [b.add({ parentKey: epic.key, status: 'in_progress', created: NOW - 5 * DAY, started: NOW - 2 * HOUR }), b.add({ parentKey: epic.key, status: 'ready', created: NOW - 4 * DAY })];
	const loose = Array.from({ length: 3 }, (_, i) => b.add({ status: 'ready', created: NOW - (3 + i) * DAY }));
	return { b, epic, children, loose, done };
}

const at = (frame: ReturnType<Transition['frame']>, key: string): DrawDot | undefined => frame.dots.find((dot) => dot.key === key);

describe('a refresh transition', () => {
	it('runs in stages: what left fades out, then what changed glides, then what arrived grows in', () => {
		const { b, loose } = board();
		const [gone, picked] = loose;
		let filed = '';
		const { transition, to, from } = scene(b.rows, (rows) => {
			const next = rows.filter((row) => row.key !== gone!.key);
			const row = next.find((r) => r.key === picked!.key)!;
			Object.assign(row, { status: 'in_progress', startedAt: iso(LATER - 1000), timeAnchor: iso(LATER - 1000) });
			const fresh = { ...row, key: 'MAP-99', status: 'ready' as const, startedAt: null, createdAt: iso(LATER), timeAnchor: iso(LATER), workers: [] };
			filed = fresh.key;
			return [...next, fresh];
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };

		const exiting = transition.frame(drawing, T0 + EXIT_MS / 2);
		expect(at(exiting, gone!.key)).toBeDefined();
		expect(exiting.effects.get(gone!.key)!.alpha).toBeLessThan(1);
		expect(at(exiting, picked!.key)!.x).toBe(from.get(picked!.key)!.x);
		expect(at(exiting, filed)).toBeUndefined();

		const moving = transition.frame(drawing, T0 + EXIT_MS + GLIDE_MS / 2);
		expect(at(moving, gone!.key)).toBeUndefined();
		const x = at(moving, picked!.key)!.x;
		expect(x).toBeGreaterThan(from.get(picked!.key)!.x);
		expect(x).toBeLessThan(to.get(picked!.key)!.x);
		expect(at(moving, filed)).toBeUndefined();

		const entering = transition.frame(drawing, T0 + EXIT_MS + GLIDE_MS + ENTER_MS / 2);
		expect(at(entering, picked!.key)!.x).toBe(to.get(picked!.key)!.x);
		expect(at(entering, filed)).toBeDefined();
		expect(entering.effects.get(filed)!.alpha).toBeLessThan(1);

		const end = T0 + EXIT_MS + GLIDE_MS + ENTER_MS;
		const done = transition.frame(drawing, end);
		expect(done.effects.size).toBe(0);
		expect(done.dots.map((dot) => [dot.key, dot.x, dot.y])).toEqual(drawing.dots.map((dot) => [dot.key, dot.x, dot.y]));
		expect(transition.animating(end)).toBe(false);
		expect(transition.finished(end)).toBe(true);
	});

	it('skips the stages with nothing in them: a glide alone starts at once', () => {
		const { b, loose } = board();
		const { transition, to, from } = scene(b.rows, (rows) => {
			Object.assign(rows.find((r) => r.key === loose[0]!.key)!, { status: 'in_progress', startedAt: iso(LATER), timeAnchor: iso(LATER) });
			return rows;
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		const key = loose[0]!.key;
		expect(at(transition.frame(drawing, T0 + GLIDE_MS / 2), key)!.x).toBeGreaterThan(from.get(key)!.x);
		expect(transition.animating(T0 + GLIDE_MS)).toBe(false);
	});

	it('restyles a status change where the dot stands, the new fill sweeping in over 250 ms', () => {
		const { b, loose } = board();
		const key = loose[1]!.key;
		const { transition, to } = scene(b.rows, (rows) => {
			// Done with no other change of moment: done items order by completion, so this one also moves; the sweep runs regardless.
			Object.assign(rows.find((r) => r.key === key)!, { status: 'done', completedAt: iso(LATER), timeAnchor: iso(LATER) });
			return rows;
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };

		const half = transition.frame(drawing, T0 + SWEEP_MS / 2).effects.get(key)!;
		expect(half.sweep!.from).toBe('ready');
		expect(half.sweep!.progress).toBeGreaterThan(0);
		expect(half.sweep!.progress).toBeLessThan(1);
		expect(transition.frame(drawing, T0 + SWEEP_MS + 1).effects.get(key)?.sweep ?? null).toBeNull();
	});

	it('sends one amber ring out of a dot an agent wrote to, once, for 900 ms', () => {
		const { b, children } = board();
		const key = children[0]!.key;
		b.work(children[0]!, 'session-a', 'laptop', 30);
		const { transition, to } = scene(b.rows, (rows) => {
			const row = rows.find((r) => r.key === key)!;
			row.workers = [{ ...row.workers[0]!, lastWriteAt: iso(LATER) }];
			row.timeAnchor = iso(LATER);
			return rows;
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };

		const rings = [0, 300, 600, 899].map((t) => transition.frame(drawing, T0 + t).effects.get(key)?.ping ?? null);
		expect(rings.every((ring) => ring !== null)).toBe(true);
		expect(rings).toEqual([...rings].sort((p, q) => p! - q!));
		expect(transition.frame(drawing, T0 + PING_MS).effects.get(key)?.ping ?? null).toBeNull();
		expect(transition.animating(T0 + PING_MS)).toBe(false);
	});

	it('grows a new item out of its parent\'s region, from the region\'s center', () => {
		const { b, epic } = board();
		let filed = '';
		const { transition, to, b: after } = scene(b.rows, (rows) => {
			const fresh = { ...rows.find((r) => r.parentKey === epic.key && r.status === 'ready')!, key: 'MAP-99', createdAt: iso(LATER), timeAnchor: iso(LATER), rank: 9 };
			filed = fresh.key;
			return [...rows, fresh];
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		const hub = after.nodes.find((node) => node.key === epic.key)!;

		const start = transition.frame(drawing, T0 + GLIDE_MS + 1);
		const effect = start.effects.get(filed)!;
		expect(effect.scale).toBeLessThan(0.1);
		expect(effect.alpha).toBe(1);
		expect(Math.hypot(at(start, filed)!.x - hub.x, at(start, filed)!.y - hub.y)).toBeLessThan(Math.hypot(to.get(filed)!.x - hub.x, to.get(filed)!.y - hub.y));
	});

	it('fades a new item with no parent in where it lands, at the right edge', () => {
		const { b, loose } = board();
		const { transition, to } = scene(b.rows, (rows) => [...rows, { ...loose[0]!, key: 'MAP-99', createdAt: iso(LATER), timeAnchor: iso(LATER) }]);
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		const frames = Array.from({ length: 60 }, (_, i) => transition.frame(drawing, T0 + i * 40));
		const first = frames.find((frame) => at(frame, 'MAP-99'))!;
		expect(first.effects.get('MAP-99')!.scale).toBe(1);
		expect(at(first, 'MAP-99')!.x).toBe(to.get('MAP-99')!.x);
		expect(to.get('MAP-99')!.x).toBeGreaterThan(Math.max(...[...to.values()].filter((dot) => dot.key !== 'MAP-99' && dot.status === 'done').map((dot) => dot.x)));
	});

	it('folds a family whose last open child finished into its done dot: the children shrink into it, then it grows in', () => {
		const b = new BoardBuilder();
		b.add({ status: 'in_progress', started: NOW - HOUR });
		const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 8 * DAY, started: NOW - 5 * DAY });
		const kids = [b.add({ parentKey: epic.key, status: 'done', completed: NOW - 2 * DAY }), b.add({ parentKey: epic.key, status: 'in_progress', started: NOW - 3 * HOUR })];
		const { transition, to, b: after } = scene(b.rows, (rows) => {
			for (const row of rows) {
				if (row.key === kids[1]!.key || row.key === epic.key) Object.assign(row, { status: 'done', completedAt: iso(LATER - 1000), timeAnchor: iso(LATER - 1000) });
			}
			return rows;
		});
		expect(after.collapsed).toContain(epic.key);
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		const folding = transition.frame(drawing, T0 + EXIT_MS / 2);
		for (const kid of kids) {
			expect(at(folding, kid.key)).toBeDefined();
			expect(folding.effects.get(kid.key)!.scale).toBeLessThan(1);
		}
		expect(at(folding, epic.key)).toBeUndefined();
		expect(folding.regions!.outgoing.map((outline) => outline.key)).toEqual([epic.key]);

		const settled = transition.frame(drawing, T0 + 5_000);
		expect(at(settled, epic.key)!.folded!.count).toBe(3);
		for (const kid of kids) expect(at(settled, kid.key)).toBeUndefined();
	});

	it('crossfades the outline of a family whose members moved, and leaves the others alone', () => {
		const { b, children } = board();
		const { transition, to } = scene(b.rows, (rows) => {
			Object.assign(rows.find((r) => r.key === children[1]!.key)!, { status: 'in_progress', startedAt: iso(LATER), timeAnchor: iso(LATER) });
			return rows;
		});
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		const half = transition.frame(drawing, T0 + GLIDE_MS / 2).regions!;
		expect([...half.incoming]).toEqual([children[1]!.parentKey]);
		expect(half.progress).toBeGreaterThan(0);
		expect(half.progress).toBeLessThan(1);
		expect(transition.frame(drawing, T0 + GLIDE_MS).regions).toBeNull();
	});
});

describe('what stays put', () => {
	const picked = (): { rows: MapItemRow[]; key: string } => {
		const { b, loose } = board();
		return { rows: b.rows, key: loose[0]!.key };
	};
	const pick = (key: string) => (rows: MapItemRow[]): MapItemRow[] => {
		Object.assign(rows.find((r) => r.key === key)!, { status: 'in_progress', startedAt: iso(LATER), timeAnchor: iso(LATER) });
		return rows;
	};

	it('holds the dot under the pointer where it was, then glides it once the pointer leaves', () => {
		const { rows, key } = picked();
		const { transition, from, to } = scene(rows, pick(key), { held: key });
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		expect(transition.held).toBe(key);
		expect(at(transition.frame(drawing, T0 + 10_000), key)!.x).toBe(from.get(key)!.x);
		expect(transition.finished(T0 + 10_000)).toBe(false);

		transition.release(T0 + 10_000);
		const half = at(transition.frame(drawing, T0 + 10_000 + GLIDE_MS / 2), key)!.x;
		expect(half).toBeGreaterThan(from.get(key)!.x);
		expect(at(transition.frame(drawing, T0 + 10_000 + GLIDE_MS), key)!.x).toBe(to.get(key)!.x);
		expect(transition.finished(T0 + 10_000 + GLIDE_MS)).toBe(true);
	});

	it('moves the camera along with a focused dot that glides, step for step, so it stays put on screen', () => {
		const { rows, key } = picked();
		const { transition, from, to } = scene(rows, pick(key), { follow: key });
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };
		let camera = 0;
		for (let t = 0; t <= GLIDE_MS; t += 16) {
			camera += transition.followStep(T0 + t)?.dx ?? 0;
			const dot = at(transition.frame(drawing, T0 + t), key)!;
			expect(dot.x - camera).toBeCloseTo(from.get(key)!.x, 6);
		}
		camera += transition.followStep(T0 + GLIDE_MS)?.dx ?? 0;
		expect(camera).toBeCloseTo(to.get(key)!.x - from.get(key)!.x, 6);
	});

	it('does not follow the focus while the pointer holds a dot, which hover leads over', () => {
		const { rows, key } = picked();
		const { transition } = scene(rows, pick(key), { follow: key, held: key });
		expect(transition.followStep(T0 + GLIDE_MS)).toBeNull();
	});

	it('stops following once the person moves the camera themselves', () => {
		const { rows, key } = picked();
		const { transition } = scene(rows, pick(key), { follow: key });
		expect(transition.followStep(T0 + 100)).not.toBeNull();
		transition.stopFollowing();
		expect(transition.followStep(T0 + 400)).toBeNull();
	});
});

describe('under reduced motion', () => {
	it('cuts to the new layout, and gives what changed the board\'s 2 s highlight instead', () => {
		const { b, loose, children } = board();
		b.work(children[0]!, 'session-a', 'laptop', 30);
		const key = loose[0]!.key;
		const { transition, to } = scene(b.rows, (rows) => {
			Object.assign(rows.find((r) => r.key === key)!, { status: 'in_progress', startedAt: iso(LATER), timeAnchor: iso(LATER) });
			const worked = rows.find((r) => r.key === children[0]!.key)!;
			worked.workers = [{ ...worked.workers[0]!, lastWriteAt: iso(LATER) }];
			return [...rows, { ...loose[1]!, key: 'MAP-99', createdAt: iso(LATER), timeAnchor: iso(LATER) }];
		}, { reduced: true });
		const drawing = { dots: [...to.values()], agents: [], links: [], regions: [], working: { computers: [], sessions: [], byNode: new Map() }, needs: new Map() };

		const first = transition.frame(drawing, T0);
		expect(first.dots.map((dot) => [dot.key, dot.x, dot.y])).toEqual(drawing.dots.map((dot) => [dot.key, dot.x, dot.y]));
		expect(first.regions).toBeNull();
		for (const effect of first.effects.values()) {
			expect(effect).toMatchObject({ alpha: 1, scale: 1, sweep: null, ping: null, highlight: true });
		}
		expect(first.effects.get(key)?.highlight).toBe(true);
		expect(first.effects.get('MAP-99')?.highlight).toBe(true);
		expect(transition.frame(drawing, T0 + HIGHLIGHT_DURATION).effects.size).toBe(0);
	});
});
