import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { buildDrawList, subtreeRollups } from './draw-list';
import { LEAF_RADIUS } from './layout/constants';

describe('draw list', () => {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const child = b.add({ parentKey: epic.key, status: 'ready' });
	const sibling = b.add({ parentKey: epic.key, status: 'done' });
	const first = b.add({ parentKey: epic.key, status: 'in_progress', subStatus: 'scoping' });
	const second = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(second, first);
	const blocker = b.add({ status: 'in_progress', subStatus: 'pr_open', prUrl: 'https://example.com/pr/1' });
	const waiting = b.add({ status: 'ready' });
	b.block(waiting, blocker);
	const found = b.add({ status: 'ready', discoveredFromKey: blocker.key });
	const paused = b.add({ status: 'in_progress', subStatus: 'paused' });
	const asked = b.add({ status: 'in_progress', subStatus: 'needs_input' });
	const held = b.add({ status: 'ready', blocked: true, textBlockerCount: 1 });
	const finished = b.add({ type: 'epic', status: 'done' });
	for (let i = 0; i < 4; i++) b.add({ parentKey: finished.key, status: 'done' });
	b.work(blocker, 'session-a', 'laptop');
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	const { dots, regions, links } = buildDrawList(layout, rows, b.now);
	const byKey = new Map(dots.map((dot) => [dot.key, dot]));

	it('draws nothing for a parent with visible children, which is a region', () => {
		expect(byKey.has(epic.key)).toBe(false);
		expect(byKey.has(child.key)).toBe(true);
		expect(byKey.has(sibling.key)).toBe(true);
		expect(regions.map((region) => region.key)).toEqual([epic.key]);
	});

	it('draws computers and sessions as agents, never as dots', () => {
		expect(layout.nodes.some((node) => node.kind !== 'item')).toBe(true);
		expect(dots.every((dot) => rows.has(dot.key))).toBe(true);
	});

	it('shows Blocked on an item with an open blocker, whatever its status', () => {
		expect(byKey.get(waiting.key)!.status).toBe('blocked');
		expect(byKey.get(child.key)!.status).toBe('ready');
	});

	it('copies each unplanned dot from its node, in layout units', () => {
		const node = layout.nodes.find((n) => n.key === sibling.key)!;
		expect(byKey.get(sibling.key)).toMatchObject({ x: node.x, y: node.y, r: node.r, weight: 1 });
	});

	it('weighs ready and blocked work by its place in the plan, smaller further down', () => {
		const planned = layout.planOrder.filter((key) => byKey.has(key)).map((key) => byKey.get(key)!);
		expect(planned.length).toBeGreaterThan(2);
		expect(planned[0]!.weight).toBe(1);
		for (let i = 1; i < planned.length; i++) expect(planned[i]!.weight).toBeLessThan(planned[i - 1]!.weight);
		expect(planned.at(-1)!.r).toBeLessThan(LEAF_RADIUS);
		// In flight work is never weighed down.
		expect(byKey.get(first.key)!.weight).toBe(1);
	});

	it('puts in-flight work after what it overlaps', () => {
		const order = dots.map((dot) => dot.status);
		expect(order.lastIndexOf('done')).toBeLessThan(order.indexOf('in_progress'));
	});

	it('carries the sub-status cues and the PR mark', () => {
		expect(byKey.get(first.key)!.cue).toBe('scoping');
		expect(byKey.get(paused.key)!.cue).toBe('paused');
		expect(byKey.get(asked.key)!.cue).toBeNull();
		expect(byKey.get(blocker.key)!.pr).toBe(true);
		expect(byKey.get(first.key)!.pr).toBe(false);
	});

	it('rings what needs a person: a question, a PR waiting on review, and a hold', () => {
		const ringed = dots.filter((dot) => dot.needsPerson).map((dot) => dot.key).sort();
		expect(ringed).toEqual([blocker.key, asked.key, held.key].sort());
	});

	it('folds a finished family into one dot carrying its count', () => {
		const dot = byKey.get(finished.key)!;
		expect(layout.collapsed).toContain(finished.key);
		expect(dot.folded).toEqual({ count: 5, rollup: { done: 4, in_flight: 0, next: 0, later: 0 }, expandable: true });
		expect(byKey.get(child.key)!.folded).toBeNull();
	});

	it('gives each region its parent\'s status and a rollup of its subtree by phase', () => {
		expect(regions[0]).toMatchObject({
			title: epic.title,
			status: 'in_progress',
			needsPerson: false,
			rollup: { done: 1, in_flight: 1, next: 1, later: 1 },
			size: 4,
		});
	});

	it('draws chain links inside the region, and every other blocker and discovered-from link by item key', () => {
		const ids = links.filter((link) => link.kind !== 'agent' && link.kind !== 'machine').map((link) => link.id).sort();
		expect(ids).toEqual(
			[`chain:${first.key}>${second.key}`, `blocker:${blocker.key}>${waiting.key}`, `discovered:${blocker.key}>${found.key}`].sort(),
		);
		const chain = links.find((link) => link.kind === 'chain')!;
		expect(chain.from).toEqual({ x: byKey.get(first.key)!.x, y: byKey.get(first.key)!.y });
		expect(links.every((link) => !link.satisfied)).toBe(true);
	});

	it('draws a session\'s amber line to each item it is on, and a tie from its computer', () => {
		const agentLinks = links.filter((link) => link.kind === 'agent' || link.kind === 'machine');
		expect(agentLinks.map((link) => [link.id, link.live])).toEqual([
			['machine:computer:laptop>session:session-a', true],
			[`agent:session:session-a>${blocker.key}`, true],
		]);
		const session = layout.nodes.find((node) => node.key === 'session:session-a')!;
		expect(agentLinks.find((link) => link.kind === 'agent')!.from).toEqual({ x: session.x, y: session.y });
	});

	it('marks the items a live session is on, and no others', () => {
		expect(dots.filter((dot) => dot.live).map((dot) => dot.key)).toEqual([blocker.key]);
	});

	it('skips a node whose row is missing rather than guessing a status', () => {
		expect(buildDrawList(layout, new Map(), b.now)).toMatchObject({ dots: [], regions: [], links: [], agents: [] });
	});
});

describe('draw list links', () => {
	it('keeps a satisfied blocker, and ties links into a folded family to its dot', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		const after = b.add({ status: 'ready' });
		b.block(after, done);
		const finished = b.add({ type: 'epic', status: 'done' });
		const folded = b.add({ parentKey: finished.key, status: 'done' });
		const later = b.add({ status: 'ready', discoveredFromKey: folded.key });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		const { links } = buildDrawList(layout, rows, b.now);

		expect(links.find((link) => link.id === `blocker:${done.key}>${after.key}`)!.satisfied).toBe(true);
		const lineage = links.find((link) => link.id === `discovered:${folded.key}>${later.key}`)!;
		const dot = layout.nodes.find((node) => node.key === finished.key)!;
		expect(lineage.from).toEqual({ x: dot.x, y: dot.y });
	});
});

describe('draw list, region glyphs and bad data', () => {
	it('gives a region\'s label glyph the parent\'s cue, PR mark, and plan weight', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress', subStatus: 'scoping', prUrl: 'https://example.com/pr/9' });
		b.add({ parentKey: epic.key, status: 'ready' });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const [region] = buildDrawList(layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 }), rows).regions;
		expect(region).toMatchObject({ key: epic.key, cue: 'scoping', pr: true, weight: 1 });
	});

	it('stops a rollup at a parent loop in the rows instead of walking it forever', () => {
		const b = new BoardBuilder();
		const one = b.add({ type: 'epic', status: 'in_progress' });
		const two = b.add({ type: 'epic', status: 'in_progress', parentKey: one.key });
		one.parentKey = two.key;
		b.add({ status: 'ready', parentKey: two.key });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const { regions } = buildDrawList(layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 }), rows);
		expect(regions.length).toBeGreaterThan(0);
		for (const region of regions) expect(region.rollup.in_flight + region.rollup.next).toBeLessThanOrEqual(3);
	});
});

describe('draw list, past the read cap', () => {
	it('draws a summarized finished family as a folded dot carrying its count, with nothing to open', () => {
		const b = new BoardBuilder();
		const summarized = b.add({ type: 'epic', status: 'done', summarizedDescendants: 40 });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		const [dot] = buildDrawList(layout, rows, b.now).dots;
		expect(dot!.key).toBe(summarized.key);
		expect(dot!.folded).toEqual({ count: 41, rollup: { done: 40, in_flight: 0, next: 0, later: 0 }, expandable: false });
	});
});

describe('subtree rollups', () => {
	it('folds a chain tens of thousands deep in one pass, with no recursion', () => {
		const b = new BoardBuilder();
		let parent: string | null = null;
		for (let i = 0; i < 20_000; i++) parent = b.add({ status: i % 2 ? 'ready' : 'done', parentKey: parent }).key;
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const phases = Object.fromEntries(b.rows.map((row) => [row.key, row.status === 'done' ? 'done' : 'next'] as const));
		const rollups = subtreeRollups(rows, phases);
		expect(rollups.get(b.rows[0]!.key)).toEqual({ done: 9_999, in_flight: 0, next: 10_000, later: 0 });
		expect(rollups.get(b.rows.at(-1)!.key)).toEqual({ done: 0, in_flight: 0, next: 0, later: 0 });
	});

	it('counts each row once on a parent loop', () => {
		const b = new BoardBuilder();
		const one = b.add({ status: 'ready' });
		const two = b.add({ status: 'ready', parentKey: one.key });
		one.parentKey = two.key;
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const rollups = subtreeRollups(rows, { [one.key]: 'next', [two.key]: 'next' });
		const total = (key: string): number => Object.values(rollups.get(key)!).reduce((sum, n) => sum + n, 0);
		expect(total(one.key) + total(two.key)).toBe(1);
	});
});
