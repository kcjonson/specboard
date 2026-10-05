import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { MINUTE } from './layout/constants';
import { layoutMap } from './layout/layout';
import { setup, WIDTH, HEIGHT } from './map-surface.fixture';

/**
 * Computers and sessions on the surface: where they draw, what hover and a click on
 * them (and on the items they work) light, the cards, how they age with the clock, and
 * the edge markers. Driven through a fake camera and renderer, like the interaction tests.
 */

interface Board {
	b: BoardBuilder;
	layout: ReturnType<typeof layoutMap>;
	rows: Map<string, ReturnType<BoardBuilder['add']>>;
	epic: string;
	/** In the epic: worked by the laptop's live session, and by its quiet one. */
	m: string;
	q: string;
	/** Worked by the desktop's session, which last wrote 50 minutes ago. */
	d: string;
	/** In progress with no session at all, and a ready item nobody is on. */
	alone: string;
	ready: string;
}

function board(): Board {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const m = b.add({ parentKey: epic.key, status: 'in_progress', title: 'Wire the index' });
	const q = b.add({ parentKey: epic.key, status: 'in_progress', title: 'Draw the cards' });
	b.add({ parentKey: epic.key, status: 'done' });
	const d = b.add({ status: 'in_progress', title: 'Write the migration' });
	const alone = b.add({ status: 'in_progress' });
	const ready = b.add({ status: 'ready' });
	b.work(m, 'live', 'laptop', 2, 95);
	b.work(q, 'quiet', 'laptop', 20, 30, 'codex');
	b.work(d, 'old', 'desktop', 50, 60);
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: WIDTH / 500 });
	return { b, layout, rows: new Map(b.rows.map((row) => [row.key, row])), epic: epic.key, m: m.key, q: q.key, d: d.key, alone: alone.key, ready: ready.key };
}

function shown(): ReturnType<typeof setup> & Board & { agentAt: (key: string) => { x: number; y: number }; dotAt: (key: string) => { x: number; y: number } } {
	const s = setup();
	const bd = board();
	s.surface.resize(WIDTH, HEIGHT);
	s.surface.setNow(bd.b.now);
	s.surface.show(bd.layout, bd.rows, null);
	s.flush();
	s.clock.now = 1000;
	const screen = (p: { x: number; y: number }): { x: number; y: number } => {
		const t = s.camera.transform;
		return { x: t.x + t.k * p.x, y: t.y + t.k * p.y };
	};
	return {
		...s,
		...bd,
		agentAt: (key) => screen(s.renderer.frames.at(-1)!.agents.find((a) => a.key === key)!),
		dotAt: (key) => screen(s.renderer.frames.at(-1)!.dots.find((dot) => dot.key === key)!),
	};
}

afterEach(() => vi.restoreAllMocks());

describe('drawing the agents', () => {
	it('draws each computer and session where the layout put it, numbered, live or quiet, with amber lines to the items', () => {
		const s = shown();
		const frame = s.renderer.frames.at(-1)!;
		expect(frame.agents.map((a) => [a.key, a.kind, a.number, a.state])).toEqual([
			['computer:desktop', 'computer', 0, 'quiet'],
			['computer:laptop', 'computer', 0, 'live'],
			['session:old', 'session', 1, 'quiet'],
			['session:live', 'session', 1, 'live'],
			['session:quiet', 'session', 2, 'quiet'],
		]);
		const lines = frame.links.filter((link) => link.kind === 'agent').map((link) => [link.id, link.live]);
		expect(lines).toEqual([
			[`agent:session:old>${s.d}`, false],
			[`agent:session:live>${s.m}`, true],
			[`agent:session:quiet>${s.q}`, false],
		]);
		expect(frame.links.filter((link) => link.kind === 'machine')).toHaveLength(3);
	});

	it('puts a still amber glow behind the item a live session is on, and no other', () => {
		const s = shown();
		expect(s.renderer.frames.at(-1)!.dots.filter((dot) => dot.live).map((dot) => dot.key)).toEqual([s.m]);
	});

	it('draws one text block per computer, naming the work, and the items it names carry no label of their own', () => {
		const s = shown();
		const frame = s.renderer.frames.at(-1)!;
		expect(frame.blocks.map((block) => block.lines.map((line) => line.text))).toEqual([
			['desktop', `Session 1: ${s.d}`],
			['laptop', `Session 1: ${s.m}`, `Session 2: ${s.q}`],
		]);
		const labelled = frame.dotLabels.map((label) => label.key);
		for (const named of [s.m, s.q, s.d]) expect(labelled).not.toContain(named);
		expect(labelled).toContain(s.alone);
	});

	it('keeps a text block clear of the dots and agents', () => {
		const s = shown();
		const frame = s.renderer.frames.at(-1)!;
		const taken = [...frame.dots.map((dot) => dot), ...frame.agents];
		const t = s.camera.transform;
		for (const block of frame.blocks) {
			for (const mark of taken) {
				const x = t.x + t.k * mark.x;
				const y = t.y + t.k * mark.y;
				const inside = x > block.box.x - 2 && x < block.box.x + block.box.w + 2 && y > block.box.y - 2 && y < block.box.y + block.box.h + 2;
				expect(inside).toBe(false);
			}
		}
	});
});

describe('hover and click on the agents', () => {
	it('hovering a session lights its computer and its items, and fades the rest', () => {
		const s = shown();
		s.surface.hoverAt(s.agentAt('session:live'));
		s.flush();
		const lit = s.renderer.frames.at(-1)!.focus.to!;
		expect(lit.key).toBe('session:live');
		expect([...lit.dots].sort()).toEqual(['computer:laptop', 'session:live', s.m].sort());
		expect(lit.dots.has('session:quiet')).toBe(false);
		expect(lit.regions.has(s.epic)).toBe(true);
		expect(s.target).toHaveBeenLastCalledWith('item');
	});

	it('hovering a computer lights every session on it and their items', () => {
		const s = shown();
		s.surface.hoverAt(s.agentAt('computer:laptop'));
		s.flush();
		const lit = s.renderer.frames.at(-1)!.focus.to!;
		expect([...lit.dots].sort()).toEqual(['computer:laptop', 'session:live', 'session:quiet', s.m, s.q].sort());
	});

	it('hovering an item lights its session and computer', () => {
		const s = shown();
		s.surface.hoverAt(s.dotAt(s.q));
		s.flush();
		const lit = s.renderer.frames.at(-1)!.focus.to!;
		expect(lit.dots.has('session:quiet')).toBe(true);
		expect(lit.dots.has('computer:laptop')).toBe(true);
		expect(lit.dots.has('session:live')).toBe(false);
	});

	it('opens a card after the beat, with client, device, branch, time on the item, and time since the last write', () => {
		const s = shown();
		s.surface.hoverAt(s.agentAt('session:live'));
		s.deferred.splice(0).forEach((task) => task());
		s.flush();
		const { quick } = s.overlay.frame;
		expect(quick).toMatchObject({ key: 'session:live', progress: null });
		expect(quick!.agent).toMatchObject({
			kind: 'session',
			title: 'Session 1 on laptop',
			chips: ['claude-code', 'Live'],
			kicker: 'Agent session · last write 2 min ago',
		});
		expect(quick!.agent!.rows).toEqual([{ key: s.m, title: 'Wire the index', meta: `feat/${s.m} · 1 h 35 min on item, last write 2 min ago` }]);
	});

	it('shows an item\'s sessions on its card: client, device, branch, time on the item, and time since the last write', () => {
		const s = shown();
		s.surface.hoverAt(s.dotAt(s.q));
		s.deferred.splice(0).forEach((task) => task());
		s.flush();
		expect(s.overlay.frame.quick!.marks.sessions).toEqual([
			{ title: 'Session 2, codex on laptop, quiet', meta: `feat/${s.q} · 30 min on item, last write 20 min ago`, quiet: true },
		]);
	});

	it('a click holds a session lit and its card open, and opens no drawer; a second click lets go', () => {
		const s = shown();
		const at = s.agentAt('session:live');
		s.surface.tap(s.surface.hitAt(at, false), false);
		s.deferred.splice(0).forEach((task) => task());
		s.flush();
		expect(s.open).not.toHaveBeenCalled();
		expect(s.surface.selection).toBe('session:live');
		expect(s.renderer.frames.at(-1)!.focus.to!.key).toBe('session:live');
		expect(s.overlay.frame.quick!.key).toBe('session:live');

		s.surface.tap(s.surface.hitAt(at, false), false);
		expect(s.surface.selection).toBeNull();
	});

	it('flies to a session, as a marker or a roster does', () => {
		const s = shown();
		expect(s.surface.focusOn('session:old')).toBe(true);
		expect(s.camera.flights).toHaveLength(1);
		expect(s.surface.focusOn('session:nope')).toBe(false);
	});
});

describe('agents ageing with the clock', () => {
	it('dims a session at 15 minutes without a write, and its lines with it, with no new layout', () => {
		const s = shown();
		const before = s.renderer.frames.length;
		s.surface.setNow(s.b.now + 14 * MINUTE);
		s.flush();
		const frame = s.renderer.frames.at(-1)!;
		expect(s.renderer.frames.length).toBeGreaterThan(before);
		expect(frame.agents.find((a) => a.key === 'session:live')!.state).toBe('quiet');
		expect(frame.agents.find((a) => a.key === 'computer:laptop')!.state).toBe('quiet');
		expect(frame.links.find((link) => link.id === `agent:session:live>${s.m}`)!.live).toBe(false);
		expect(frame.dots.some((dot) => dot.live)).toBe(false);
	});

	it('drops a session after an hour, with its lines, its computer when it was the last, and its place in the text block', () => {
		const s = shown();
		// The desktop's only session last wrote 50 minutes before the layout.
		s.surface.setNow(s.b.now + 11 * MINUTE);
		s.flush();
		const frame = s.renderer.frames.at(-1)!;
		expect(frame.agents.map((a) => a.key)).not.toContain('session:old');
		expect(frame.agents.map((a) => a.key)).not.toContain('computer:desktop');
		expect(frame.links.some((link) => link.id.includes('session:old'))).toBe(false);
		expect(frame.blocks.map((block) => block.key)).toEqual(['computer:laptop']);
		// The item it was on is where it was: the layout is not run again, and the next read decides where it goes.
		expect(frame.dots.some((dot) => dot.key === s.d)).toBe(true);
	});

	it('rings an in-progress item once every session on it has gone quiet, and the item stays in its place', () => {
		const s = shown();
		expect(s.renderer.frames.at(-1)!.dots.find((dot) => dot.key === s.m)!.reason).toBeNull();
		const before = s.dotAt(s.m);
		s.surface.setNow(s.b.now + 14 * MINUTE);
		s.flush();
		expect(s.renderer.frames.at(-1)!.dots.find((dot) => dot.key === s.m)!.reason).toBe('quiet');
		expect(s.dotAt(s.m)).toEqual(before);
		// The one that was already quiet at the layout rang from the start.
		expect(s.renderer.frames.at(-1)!.dots.find((dot) => dot.key === s.q)!.reason).toBe('quiet');
	});

	it('repaints nothing for a tick that crosses no threshold', () => {
		const s = shown();
		s.surface.setNow(s.b.now + 60_000);
		s.flush();
		const frames = s.renderer.frames.length;
		s.surface.setNow(s.b.now + 2 * 60_000);
		expect(s.frames).toHaveLength(0);
		s.flush();
		expect(s.renderer.frames.length).toBe(frames);
	});

	it('lets go of a session that was held when it leaves, rather than leave the Map dimmed around nothing', () => {
		const s = shown();
		s.surface.tap(s.surface.hitAt(s.agentAt('session:old'), false), false);
		s.flush();
		expect(s.surface.selection).toBe('session:old');
		s.surface.setNow(s.b.now + 11 * MINUTE);
		s.flush();
		expect(s.surface.selection).toBeNull();
		expect(s.overlay.frame.quick).toBeNull();
		expect(s.renderer.frames.at(-1)!.focus.to).toBeNull();
	});
});

describe('edge markers', () => {
	/** Zoomed in on the far left of the Map, where the right edge's computers and sessions are off screen, with markers asked for as the page does. */
	function away(): ReturnType<typeof shown> {
		const s = shown();
		s.surface.setEdgeMarkers([
			{ key: 'session:live', kind: 'live', label: 'Session 1 on laptop' },
			{ key: s.q, kind: 'needs-person' },
			{ key: 'session:nope', kind: 'live' },
		]);
		const bounds = s.layout.frame.bounds;
		s.camera.set({ k: 3, x: -3 * bounds.minX, y: -3 * bounds.minY });
		s.flush();
		return s;
	}

	it('points toward a live session that is off screen, along the right edge', () => {
		const s = away();
		const live = s.overlay.frame.edges.filter((marker) => marker.kind === 'live');
		expect(live.map((marker) => marker.key)).toEqual(['session:live']);
		expect(live[0]!.x).toBeGreaterThan(WIDTH / 2);
		expect(live[0]!.angle).toBeLessThan(Math.PI / 2);
		expect(live[0]!.angle).toBeGreaterThan(-Math.PI / 2);
	});

	it('marks an item that needs a person when it is off screen', () => {
		const s = away();
		expect(s.overlay.frame.edges.some((marker) => marker.kind === 'needs-person' && marker.key === s.q)).toBe(true);
	});

	it('skips a session that has left the cluster, and marks nothing at fit all, where everything is in view', () => {
		const s = shown();
		s.surface.setEdgeMarkers([{ key: 'session:live', kind: 'live' }, { key: s.m, kind: 'needs-person' }]);
		s.flush();
		expect(s.overlay.frame.edges).toEqual([]);
		s.surface.setNow(s.b.now + 2 * 60 * MINUTE);
		s.surface.setEdgeMarkers([{ key: 'session:live', kind: 'live' }]);
		const bounds = s.layout.frame.bounds;
		s.camera.set({ k: 3, x: -3 * bounds.minX, y: -3 * bounds.minY });
		s.flush();
		expect(s.overlay.frame.edges).toEqual([]);
	});

	it('keeps clear of the toolbar', () => {
		const s = away();
		const toolbar = { x: 0, y: 0, w: WIDTH, h: 200 };
		s.surface.setChrome([toolbar]);
		s.flush();
		for (const marker of s.overlay.frame.edges) expect(marker.y - 13).toBeGreaterThanOrEqual(toolbar.h);
	});

	it('stays out from under the drawer', () => {
		const s = away();
		s.surface.setCovered(300);
		s.flush();
		for (const marker of s.overlay.frame.edges) expect(marker.x).toBeLessThanOrEqual(WIDTH - 300);
	});
});
