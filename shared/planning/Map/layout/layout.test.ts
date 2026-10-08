import type { MapItemRow } from '@specboard/core/map-read';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardBuilder, NOW, iso, realisticBoard, syntheticBoard, type RealisticBoard } from './board-fixture';
import { COLD_TICKS, COLLISION_PAD, ORDER_GAP, REFIT_TICKS } from './constants';
import { bloomWidth } from './forces';
import { layoutMap } from './layout';
import { shiftX, timeToX } from './time-scale';
import type { MapLayout, MapNode } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ASPECT = 2.5;
/**
 * How far a stranger's center must stay from a region's dots, past their radius:
 * the loose pad the renderer's field draws around a family's children.
 */
const REGION_PAD = 16;

const layout = (rows: MapItemRow[], collapse: Record<string, boolean> = {}): MapLayout =>
	layoutMap({ rows, now: NOW, collapse, aspect: ASPECT });

const nodesOf = (result: MapLayout): Map<string, MapNode> => new Map(result.nodes.map((n) => [n.key, n]));
const dots = (result: MapLayout): MapNode[] => result.nodes.filter((n) => n.kind === 'item' && !n.hub);
const positions = (result: MapLayout): Record<string, { x: number; y: number }> =>
	Object.fromEntries(result.nodes.map((n) => [n.key, { x: n.x, y: n.y }]));

/** Done dots in completion order, the way the read stamps it. */
function doneInOrder(result: MapLayout, rows: readonly MapItemRow[]): MapNode[] {
	const node = nodesOf(result);
	return rows
		.filter((row) => row.status === 'done' && node.get(row.key) && !node.get(row.key)!.hub)
		.sort((a, b) => Date.parse(a.completedAt ?? a.timeAnchor) - Date.parse(b.completedAt ?? b.timeAnchor) || compareNumber(a.key, b.key))
		.map((row) => node.get(row.key)!);
}

function compareNumber(a: string, b: string): number {
	return Number(a.split('-')[1]) - Number(b.split('-')[1]);
}

function reversedDonePairs(result: MapLayout, rows: readonly MapItemRow[]): number {
	const done = doneInOrder(result, rows);
	let reversed = 0;
	for (let i = 1; i < done.length; i++) if (done[i]!.x < done[i - 1]!.x) reversed++;
	return reversed;
}

function expectOrdersHold(result: MapLayout, rows: readonly MapItemRow[]): void {
	const node = nodesOf(result);
	const done = doneInOrder(result, rows);
	expect(reversedDonePairs(result, rows)).toBe(0);

	const lastCompletion = Math.max(...done.map((n) => n.x + n.r));
	for (const row of rows) {
		const n = node.get(row.key);
		if (!n || n.hub || (row.status !== 'in_progress' && row.status !== 'in_review')) continue;
		expect(n.x - n.r).toBeGreaterThan(lastCompletion);
	}

	const cyclic = new Set(result.deadlocked);
	for (const row of rows) {
		if (row.status === 'done') continue;
		const blocked = node.get(result.representative[row.key]!)!;
		for (const link of row.blockers) {
			if (cyclic.has(row.key) && cyclic.has(link.blockerKey)) continue;
			const blocker = node.get(result.representative[link.blockerKey]!)!;
			if (blocker === blocked || blocker.hub || blocked.hub) continue;
			expect(blocked.x).toBeGreaterThanOrEqual(blocker.x + blocker.r + blocked.r + ORDER_GAP - 1e-9);
		}
	}
}

/**
 * No two dots touch, and every pair keeps at least `pad` between edges. Collision asks
 * for 4 but is soft, as d3's is, so a crowded family can settle a little inside it.
 */
function expectNoOverlaps(result: MapLayout, pad = 0): void {
	const placed = result.nodes.filter((n) => !n.hub);
	let closest = Infinity;
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			const a = placed[i]!;
			const b = placed[j]!;
			closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
		}
	}
	expect(closest).toBeGreaterThan(pad);
}

/**
 * The renderer draws a region as a field around its dots, so the proxy for "inside a
 * region" is a dot's center within a member's radius plus the region's pad. That holds
 * for nested regions too: a parent's own children stay out of a sub-epic's region.
 */
function strangersInRegions(result: MapLayout): string[] {
	const node = nodesOf(result);
	const strangers: string[] = [];
	for (const region of result.regions) {
		const members = new Set(region.members);
		for (const dot of dots(result)) {
			if (members.has(dot.key)) continue;
			for (const key of region.members) {
				const m = node.get(key)!;
				if (Math.hypot(m.x - dot.x, m.y - dot.y) < m.r + REGION_PAD) strangers.push(`${dot.key} in ${region.key}`);
			}
		}
	}
	return strangers;
}

describe('layoutMap on a realistic board', () => {
	let board: RealisticBoard;
	let result: MapLayout;

	beforeAll(() => {
		board = realisticBoard();
		result = layout(board.rows);
	});

	it('is deterministic, whatever order the rows arrive in', () => {
		expect(layout(board.rows)).toEqual(result);
		expect(layout([...board.rows].reverse())).toEqual(result);
	});

	it('places every visible node, folding the finished epic into one dot', () => {
		const node = nodesOf(result);
		expect(board.rows.length).toBeGreaterThanOrEqual(195);
		expect(result.collapsed).toEqual([board.finished.key]);
		expect(node.get(board.finished.key)!.r).toBeCloseTo(6 + 2.3 * Math.sqrt(100));
		expect(node.has(board.rows.find((r) => r.parentKey === board.finished.key)!.key)).toBe(false);
		for (const n of result.nodes) {
			expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
		}
		expect(result.nodes.filter((n) => n.kind === 'computer').map((n) => n.key)).toEqual(['computer:build-box', 'computer:personal-laptop']);
		expect(result.nodes.filter((n) => n.kind === 'session')).toHaveLength(3);
	});

	it('keeps the date and dependency orders', () => {
		expectOrdersHold(result, board.rows);
	});

	it('keeps dots apart, by close to the collision pad', () => {
		expectNoOverlaps(result, COLLISION_PAD - 0.5);
	});

	it('gives hubs no size and packs children around them rather than ringing them', () => {
		const node = nodesOf(result);
		for (const region of result.regions) {
			const hub = node.get(region.key)!;
			expect(hub.r).toBe(0);
			const distances = region.members.map((key) => Math.hypot(node.get(key)!.x - hub.x, node.get(key)!.y - hub.y));
			expect(Math.min(...distances)).toBeLessThan(0.5 * Math.max(...distances));
		}
	});

	it('keeps strangers out of regions', () => {
		expect(strangersInRegions(result)).toEqual([]);
	});

	it('nests the sub-epic’s region inside its parent’s', () => {
		const nested = result.regions.find((r) => r.key === board.nested.key)!;
		const inner = result.regions.find((r) => r.parentKey === board.nested.key)!;
		expect(inner.depth).toBe(1);
		for (const key of inner.members) expect(nested.members).toContain(key);
	});

	it('keeps a finished chain’s links and order', () => {
		const node = nodesOf(result);
		const keys = board.finishedChain.map((r) => r.key);
		const chain = result.chains.find((c) => c.items[0] === keys[0])!;
		expect(chain.items).toEqual(keys);
		expect(chain.links).toEqual([
			{ blocker: keys[0], blocked: keys[1], satisfied: true },
			{ blocker: keys[1], blocked: keys[2], satisfied: true },
		]);
		for (let i = 1; i < keys.length; i++) expect(node.get(keys[i]!)!.x).toBeGreaterThanOrEqual(node.get(keys[i - 1]!)!.x);
	});

	it('fans a burst of completions out in order instead of stacking it on one x', () => {
		const node = nodesOf(result);
		const burst = board.burst.map((row) => node.get(row.key)!);
		// Closed in order, so left to right in order, each a little past the last.
		for (let i = 1; i < burst.length; i++) expect(burst[i]!.x - burst[i - 1]!.x).toBeGreaterThan(1);
		const extent = burst.at(-1)!.x - burst[0]!.x;
		expect(extent).toBeGreaterThan(3 * 2 * burst[0]!.r);
		// Never carried further from its moment than the cloud it blooms into.
		const moment = timeToX(result.frame.scale, Date.parse(board.burst[0]!.completedAt!));
		for (const n of burst) expect(Math.abs(n.x - moment)).toBeLessThan(2 * bloomWidth(burst.length) + 2 * n.r);
		const xs = dots(result).filter((n) => result.phases[n.key] === 'done').map((n) => n.x);
		const crowd = Math.max(...xs.map((x) => xs.filter((other) => Math.abs(other - x) < 2).length));
		expect(crowd).toBeLessThanOrEqual(3);
	});

	it('lays each open chain out left to right and keeps two related chains a row apart', () => {
		const node = nodesOf(result);
		const rows = board.openChains.map((chain) => chain.map((r) => node.get(r.key)!));
		for (const row of rows) {
			for (let i = 1; i < row.length; i++) {
				const dx = row[i]!.x - row[i - 1]!.x;
				expect(dx).toBeGreaterThan(0);
				// More along the row than across it.
				expect(Math.abs(row[i]!.y - row[i - 1]!.y)).toBeLessThan(dx);
			}
		}
		// Level: the pull toward one common height keeps a chain from sloping a step at a time.
		for (const row of rows) for (let i = 1; i < row.length; i++) expect(Math.abs(row[i]!.y - row[i - 1]!.y)).toBeLessThan(5);
		const meanY = (row: MapNode[]): number => row.reduce((sum, n) => sum + n.y, 0) / row.length;
		const apart = Math.abs(meanY(rows[0]!) - meanY(rows[1]!));
		const want = Math.max(...rows[0]!.map((n) => n.r)) + Math.max(...rows[1]!.map((n) => n.r)) + 10;
		expect(apart).toBeGreaterThan(0.5 * want);
		expect(apart).toBeLessThan(2 * want);
	});

	it('holds computers past now and their sessions near their work', () => {
		const node = nodesOf(result);
		const rightmostItem = Math.max(...dots(result).map((n) => n.x));
		for (const computer of result.nodes.filter((n) => n.kind === 'computer')) {
			expect(computer.x).toBeGreaterThan(0);
			expect(computer.x).toBeGreaterThan(rightmostItem);
		}
		expect(result.frame.bounds.maxX).toBeGreaterThanOrEqual(0.6 * result.frame.scale.unit);
		for (const session of result.sessions) {
			const at = node.get(`session:${session.key}`)!;
			for (const key of session.items) {
				const item = node.get(result.representative[key]!)!;
				expect(Math.hypot(at.x - item.x, at.y - item.y)).toBeLessThan(120);
			}
		}
	});

	it('derives the sets the renderer draws from', () => {
		expect(result.upNext).toHaveLength(3);
		expect(result.upNext[0]).toBe(board.openChains[1][0]!.key);
		expect(result.phases[board.epic.key]).toBe('in_flight');
		expect(result.regions.map((r) => r.key).sort()).toEqual([board.epic.key, board.nested.key, result.regions.find((r) => r.depth === 1)!.key].sort());
		expect(result.computers.map((c) => [c.device, c.sessions.length])).toEqual([
			['build-box', 1],
			['personal-laptop', 2],
		]);
		expect(result.ticks.length).toBeGreaterThan(30);
		expect(result.quiet).toBeNull();
	});

	describe('after three pickups, a local pass', () => {
		let after: MapLayout;
		let rows: MapItemRow[];

		beforeAll(() => {
			rows = board.rows.map((row) => ({ ...row, workers: [...row.workers], blockers: [...row.blockers] }));
			for (const pickup of board.pickups) {
				const row = rows.find((r) => r.key === pickup.key)!;
				row.status = 'in_progress';
				row.subStatus = 'in_development';
				row.startedAt = iso(NOW);
				row.timeAnchor = iso(NOW);
				row.workers = [{ sessionKey: 'session-new', personName: null, deviceName: 'personal-laptop', client: 'claude-code', branch: null, startedAt: iso(NOW), lastWriteAt: iso(NOW) }];
			}
			after = layoutMap({
				rows,
				now: NOW,
				collapse: {},
				aspect: ASPECT,
				previous: { frame: result.frame, positions: positions(result), changed: board.pickups.map((p) => p.key) },
			});
		});

		it('leaves at least 90% of dots within 4 units of where they were', () => {
			const before = nodesOf(result);
			const still = dots(after).filter((n) => {
				const was = before.get(n.key);
				return was && Math.hypot(n.x - was.x, n.y - was.y) <= 4;
			});
			const shared = dots(after).filter((n) => before.has(n.key));
			expect(still.length / shared.length).toBeGreaterThanOrEqual(0.9);
		});

		it('moves the picked-up items past the last completion', () => {
			const before = nodesOf(result);
			for (const pickup of board.pickups) {
				const now = nodesOf(after).get(pickup.key)!;
				expect(now.x).toBeGreaterThan(before.get(pickup.key)!.x);
			}
		});

		it('keeps the scale at the same moment, so nothing rescales, and the extent only grows', () => {
			expect(after.frame.scale).toEqual(result.frame.scale);
			expect(after.frame.quiet).toBe(result.frame.quiet);
			expect(after.ticks).toEqual(result.ticks);
			const was = result.frame.bounds;
			const is = after.frame.bounds;
			expect(is.minX).toBeLessThanOrEqual(was.minX + 1e-9);
			expect(is.maxX).toBeGreaterThanOrEqual(was.maxX);
			expect(is.minY).toBeLessThanOrEqual(was.minY);
			expect(is.maxY).toBeGreaterThanOrEqual(was.maxY);
		});

		it('still keeps every order', () => {
			expectOrdersHold(after, rows);
		});
	});

	describe('three hours on, a local pass with nothing changed', () => {
		let later: MapLayout;

		beforeAll(() => {
			later = layoutMap({ rows: board.rows, now: NOW + 3 * HOUR, collapse: {}, aspect: ASPECT, previous: { frame: result.frame, positions: positions(result), changed: [] } });
		});

		it('moves the edge to the new now and slides the past left as one, each dot by its moment', () => {
			expect(later.frame.scale.edge).toBe(NOW + 3 * HOUR);
			expect(later.frame.scale.unit).toBe(result.frame.scale.unit);
			const before = nodesOf(result);
			const shifted = dots(later).filter((node) => {
				const was = before.get(node.key)!;
				return was.x < 0 && Math.abs(node.x - shiftX(result.frame.scale, later.frame.scale, was.x)) < 0.5 && Math.abs(node.y - was.y) < 0.5;
			});
			const past = dots(later).filter((node) => before.get(node.key)!.x < 0);
			// The rest are held by an order: in-flight work stays past the last completion, which slid with the done work, and a burst keeps its fan,
			// which pools again where the slid scale brings neighbors closer than the fan's step (a few units, however the fit lands the width).
			expect(shifted.length / past.length).toBeGreaterThanOrEqual(0.75);
			for (const node of past) expect(node.x).toBeLessThan(before.get(node.key)!.x);
		});

		it('slides recent work further than old work, as the log scale does', () => {
			const before = nodesOf(result);
			const slide = (key: string): number => nodesOf(later).get(key)!.x - before.get(key)!.x;
			const recent = board.burst[0]!.key;
			const old = board.finished.key;
			expect(slide(recent)).toBeLessThan(slide(old));
		});

		it('moves the ruler with it', () => {
			expect(later.ticks[0]!.time).toBe(NOW + 3 * HOUR - DAY);
		});

		it('keeps every order', () => {
			expectOrdersHold(later, board.rows);
		});
	});
});

describe('layoutMap edge cases', () => {
	it('fits a new board whose items were all filed this moment', () => {
		const b = new BoardBuilder();
		for (let epic = 0; epic < 2; epic++) {
			const parent = b.add({ type: 'epic', status: 'ready', created: NOW });
			for (let i = 0; i < 5; i++) b.add({ parentKey: parent.key, status: 'ready', created: NOW });
		}
		const result = layout(b.rows);
		const { minX, maxX, minY, maxY } = result.frame.bounds;
		// No stretch of time to spread over: the width is the reserved strip and the dots, not a runaway unit.
		expect(result.frame.scale.unit).toBeLessThan(5_000);
		expect((maxX - minX) / (maxY - minY)).toBeLessThan(2 * ASPECT);
		expectNoOverlaps(result);
	});

	it('lays out an empty board', () => {
		const result = layout([]);
		expect(result.nodes).toEqual([]);
		expect(result.upNext).toEqual([]);
	});

	describe('a floor is a minimum, not a destination', () => {
		/** The most dots sharing one x, give or take 2 units: a fence scores its height. */
		const crowdOnOneX = (placed: MapNode[]): number =>
			Math.max(...placed.map((n) => placed.filter((m) => Math.abs(m.x - n.x) < 2).length));
		const extentX = (placed: MapNode[]): number => Math.max(...placed.map((n) => n.x)) - Math.min(...placed.map((n) => n.x));

		it('blooms a burst of in-flight work into a cloud past the last completion', () => {
			// Twenty in-flight children of an epic whose done work is weeks back: the family
			// pulls them left, the floor holds them, and they used to line up on it.
			const b = new BoardBuilder();
			const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 20 * DAY, started: NOW - 20 * DAY });
			for (let i = 0; i < 25; i++) b.add({ parentKey: epic.key, status: 'done', created: NOW - 20 * DAY, completed: NOW - 15 * DAY + i * 8 * HOUR });
			const burst = Array.from({ length: 20 }, (_, i) =>
				b.add({ parentKey: epic.key, status: i % 3 ? 'in_progress' : 'in_review', created: NOW - 3 * DAY, started: NOW - HOUR }),
			);
			for (let i = 0; i < 20; i++) b.add({ status: 'done', created: NOW - 5 * DAY, completed: NOW - 4 * DAY + i * 4 * HOUR });
			const result = layout(b.rows);
			const node = nodesOf(result);
			const placed = burst.map((row) => node.get(row.key)!);
			expectOrdersHold(result, b.rows);
			expect(crowdOnOneX(placed)).toBeLessThanOrEqual(3);
			expect(extentX(placed)).toBeGreaterThan(3 * 2 * placed[0]!.r);
		});

		it('spreads what one blocker holds instead of stacking it on one x', () => {
			// Twelve tasks of an older epic, all waiting on one item in flight: their family
			// pulls them left, the dependency holds them, and they used to line up on it.
			const b = new BoardBuilder();
			const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 20 * DAY, started: NOW - 20 * DAY });
			for (let i = 0; i < 20; i++) b.add({ parentKey: epic.key, status: 'done', created: NOW - 20 * DAY, completed: NOW - 15 * DAY + i * 8 * HOUR });
			const blocker = b.add({ status: 'in_progress', created: NOW - 2 * DAY, started: NOW - HOUR });
			const waiting = Array.from({ length: 12 }, () => b.add({ parentKey: epic.key, status: 'ready', created: NOW - 9 * DAY }));
			for (const row of waiting) b.block(row, blocker);
			const result = layout(b.rows);
			const node = nodesOf(result);
			const placed = waiting.map((row) => node.get(row.key)!);
			expectOrdersHold(result, b.rows);
			expect(crowdOnOneX(placed)).toBeLessThanOrEqual(3);
			expect(extentX(placed)).toBeGreaterThan(3 * 2 * placed[0]!.r);
		});
	});

	it('lays a blocker cycle out without oscillating', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const cycle = [0, 1, 2].map((i) => b.add({ parentKey: epic.key, status: 'ready', created: NOW - (i + 1) * DAY }));
		b.block(cycle[1]!, cycle[0]!);
		b.block(cycle[2]!, cycle[1]!);
		b.block(cycle[0]!, cycle[2]!);
		const after = b.add({ status: 'ready' });
		b.block(after, cycle[2]!);
		for (let i = 0; i < 8; i++) b.add({ status: 'done', completed: NOW - i * DAY });
		const result = layout(b.rows);
		expect(result.deadlocked).toEqual(cycle.map((r) => r.key));
		expect(result.stats.settle).toBeLessThan(0.05);
		expect(layout(b.rows)).toEqual(result);
		expectOrdersHold(result, b.rows);
	});

	it('stays a band when chains in sibling regions block each other', () => {
		// The shape that sent a real board's y to ±4e8: open epics filed together, each holding
		// a chain, with blockers and discovered-from links reaching across into the next epic's chain.
		const b = new BoardBuilder();
		const chains = Array.from({ length: 7 }, () => {
			const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 2 * DAY });
			const chain = Array.from({ length: 4 }, () => b.add({ parentKey: epic.key, status: 'ready', created: NOW - 2 * DAY }));
			for (let i = 1; i < chain.length; i++) b.block(chain[i]!, chain[i - 1]!);
			return chain;
		});
		for (let i = 1; i < chains.length; i++) {
			b.block(chains[i]![1]!, chains[i - 1]![2]!);
			b.add({ parentKey: chains[i]![0]!.parentKey, status: 'ready', created: NOW - DAY, discoveredFromKey: chains[i - 1]![3]!.key });
		}
		for (let i = 0; i < 10; i++) b.add({ status: 'done', completed: NOW - (i + 3) * DAY });
		const result = layout(b.rows);
		const items = dots(result);
		const extent = (values: number[]): number => Math.max(...values) - Math.min(...values);
		expect(extent(items.map((n) => n.y))).toBeLessThan(extent(items.map((n) => n.x)));
		expect(result.stats.settle).toBeLessThan(0.05);
	});

	it('doesn’t hold a collapsed open family right of a done child’s old blocker', () => {
		const b = new BoardBuilder();
		const blocker = b.add({ status: 'ready', created: NOW - HOUR });
		const epic = b.add({ type: 'epic', status: 'ready', created: NOW - 30 * DAY });
		const child = b.add({ parentKey: epic.key, status: 'done', created: NOW - 30 * DAY, completed: NOW - 29 * DAY });
		b.add({ parentKey: epic.key, status: 'ready', created: NOW - 30 * DAY });
		b.block(child, blocker, 'open');
		for (let i = 0; i < 6; i++) b.add({ status: 'done', completed: NOW - i * 4 * DAY });
		const folded = layout(b.rows, { [epic.key]: true });
		const node = nodesOf(folded);
		expect(folded.representative[child.key]).toBe(epic.key);
		expect(node.get(epic.key)!.x).toBeLessThan(node.get(blocker.key)!.x);
	});

	it('runs cold instead of locally when a quiet board wakes up', () => {
		const b = new BoardBuilder();
		for (let i = 0; i < 8; i++) b.add({ status: i % 2 ? 'done' : 'ready', created: NOW - (3 + i) * DAY, completed: NOW - 3 * DAY - i * HOUR });
		const quiet = layout(b.rows);
		expect(quiet.quiet).not.toBeNull();
		expect(quiet.frame.quiet).toBe(true);
		const picked = b.rows.map((row) => ({ ...row }));
		picked[0] = { ...picked[0]!, status: 'in_progress', startedAt: iso(NOW), timeAnchor: iso(NOW) };
		const woke = layoutMap({
			rows: picked,
			now: NOW,
			collapse: {},
			aspect: ASPECT,
			previous: { frame: quiet.frame, positions: positions(quiet), changed: [picked[0]!.key] },
		});
		expect(woke.quiet).toBeNull();
		expect(woke.frame.quiet).toBe(false);
		expect(woke.frame.scale.edge).toBe(NOW);
	});

	it('runs cold when a quiet board’s last activity moves', () => {
		const b = new BoardBuilder();
		for (let i = 0; i < 8; i++) b.add({ status: 'done', completed: NOW - 3 * DAY - i * HOUR });
		const before = layout(b.rows);
		const rows = b.rows.slice(1);
		const after = layoutMap({ rows, now: NOW, collapse: {}, aspect: ASPECT, previous: { frame: before.frame, positions: positions(before), changed: [] } });
		expect(after.quiet!.since).toBe(NOW - 3 * DAY - HOUR);
		expect(after.frame.scale.edge).toBe(after.quiet!.since + HOUR);
	});

	it('lets every computer find its row when a local pass adds one', () => {
		const b = new BoardBuilder();
		const first = b.add({ status: 'in_progress' });
		const second = b.add({ status: 'ready' });
		for (let i = 0; i < 6; i++) b.add({ status: 'done', completed: NOW - (i + 1) * DAY });
		b.work(first, 's-1', 'laptop');
		const before = layout(b.rows);
		const rows = b.rows.map((row) => ({ ...row, workers: [...row.workers] }));
		const picked = rows.find((row) => row.key === second.key)!;
		picked.status = 'in_progress';
		picked.startedAt = iso(NOW);
		picked.timeAnchor = iso(NOW);
		picked.workers = [{ sessionKey: 's-2', personName: null, deviceName: 'desk', client: 'claude-code', branch: null, startedAt: iso(NOW), lastWriteAt: iso(NOW) }];
		const after = layoutMap({
			rows,
			now: NOW,
			collapse: {},
			aspect: ASPECT,
			previous: { frame: before.frame, positions: positions(before), changed: [second.key] },
		});
		const node = nodesOf(after);
		const gap = Math.abs(node.get('computer:desk')!.y - node.get('computer:laptop')!.y);
		expect(gap).toBeGreaterThan(100);
	});

	it('scatters ten unrelated items in a loose cloud near the right edge', () => {
		const b = new BoardBuilder();
		for (let i = 0; i < 10; i++) b.add({ status: 'ready', created: NOW - i * 2 * HOUR });
		const result = layout(b.rows);
		const placed = dots(result);
		expect(placed).toHaveLength(10);
		expectNoOverlaps(result, COLLISION_PAD - 0.5);
		const ys = placed.map((n) => n.y);
		expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
		const xs = placed.map((n) => n.x);
		const { minX, maxX } = result.frame.bounds;
		// The cloud sits toward now rather than spreading across the whole canvas.
		expect(Math.min(...xs)).toBeGreaterThan(minX - 1);
		expect(Math.max(...xs)).toBeLessThanOrEqual(maxX);
		expect(result.upNext).toHaveLength(3);
		expect(result.regions).toEqual([]);
	});

	it('ends the Map past the last dot, with no strip held for agents, until a computer is working', () => {
		const b = new BoardBuilder();
		for (let i = 0; i < 10; i++) b.add({ status: 'ready', created: NOW - i * 2 * HOUR });
		const idle = layout(b.rows);
		const rightmost = Math.max(...idle.nodes.map((n) => n.x + n.r));
		expect(idle.computers).toEqual([]);
		expect(idle.frame.bounds.maxX).toBeLessThan(Math.max(rightmost, 0.1 * idle.frame.scale.unit) + 1);

		const working = b.rows.find((row) => row.status === 'ready')!;
		working.status = 'in_progress';
		working.startedAt = iso(NOW - HOUR);
		b.work(working, 'session-a', 'desk', 2);
		const busy = layout(b.rows);
		expect(busy.computers).toHaveLength(1);
		expect(busy.frame.bounds.maxX).toBeGreaterThanOrEqual(0.6 * busy.frame.scale.unit);
	});

	it('keeps a session beside its own computer when its items sit in families far apart', () => {
		const b = new BoardBuilder();
		const worked: MapItemRow[] = [];
		for (let family = 0; family < 6; family++) {
			const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 60 * DAY });
			for (let i = 0; i < 12; i++) b.add({ parentKey: epic.key, status: 'done', created: NOW - 60 * DAY, completed: NOW - (55 - i * 2 - family) * DAY });
			worked.push(b.add({ parentKey: epic.key, status: 'in_progress', created: NOW - 5 * DAY, started: NOW - 2 * HOUR }));
		}
		worked.forEach((row, i) => b.work(row, i < 3 ? 'session-a' : 'session-b', i < 3 ? 'desk' : 'laptop', 3));
		const result = layout(b.rows);
		const node = nodesOf(result);
		for (const session of result.sessions) {
			const at = node.get(`session:${session.key}`)!;
			const own = node.get(`computer:${session.device}`)!;
			const others = result.computers.filter((c) => c.device !== session.device).map((c) => node.get(`computer:${c.device}`)!);
			expect(Math.hypot(at.x - own.x, at.y - own.y)).toBeLessThan(150);
			for (const other of others) expect(Math.hypot(at.x - other.x, at.y - other.y)).toBeGreaterThan(Math.hypot(at.x - own.x, at.y - own.y));
		}
		// Each worked item stays in its own family's region, not dragged out to the computers.
		for (const region of result.regions) {
			const members = region.members.map((key) => node.get(key)!);
			const inFamily = members.filter((m) => worked.some((w) => w.key === m.key));
			for (const m of inFamily) {
				const others = members.filter((o) => o !== m);
				const nearest = Math.min(...others.map((o) => Math.hypot(o.x - m.x, o.y - m.y)));
				expect(nearest).toBeLessThan(250);
			}
		}
	});

	it('holds up at one huge epic', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 40 * DAY });
		for (let i = 0; i < 300; i++) {
			const status = i < 180 ? 'done' : i < 190 ? 'in_progress' : 'ready';
			b.add({ parentKey: epic.key, status, created: NOW - 40 * DAY + i * 3 * HOUR, completed: NOW - 38 * DAY + i * 4 * HOUR });
		}
		for (let i = 0; i < 20; i++) b.add({ status: 'ready', created: NOW - i * 2 * DAY });
		const result = layout(b.rows);
		expect(result.regions).toHaveLength(1);
		expect(result.regions[0]!.members).toHaveLength(300);
		expectOrdersHold(result, b.rows);
		expectNoOverlaps(result, COLLISION_PAD / 2);
		expect(strangersInRegions(result)).toEqual([]);
	});

	describe('lays out 1,000 items without superlinear cost', () => {
		/**
		 * Wall time under a loaded runner (and CPU time too: workers share cores and caches) can't
		 * hold a 500 ms line, so what is asserted is what a regression changes whatever the machine
		 * does: the work the simulation is bounded to (its tick count, fixed by the spec's starting
		 * values), how the cost grows with the board (1,000 items against 500, measured back to back
		 * so the load is the same on both, best of several), and a ceiling ten times the budget that
		 * only a gross regression crosses. The budgets themselves (under half a second as the Map
		 * opens, under a second with every family open) are measured on a quiet machine and written
		 * in the spec's Performance section.
		 */
		const small = syntheticBoard(500, 7);
		const large = syntheticBoard(1000, 7);
		const open = (rows: MapItemRow[]): Record<string, boolean> => Object.fromEntries(rows.filter((r) => r.type === 'epic').map((r) => [r.key, false]));
		const time = (rows: MapItemRow[], collapse: Record<string, boolean>): number => {
			const start = globalThis.performance.now();
			layout(rows, collapse);
			return globalThis.performance.now() - start;
		};
		const costs = (collapse: (rows: MapItemRow[]) => Record<string, boolean>): { small: number; large: number } => {
			time(small, collapse(small));
			time(large, collapse(large));
			let best = { small: Infinity, large: Infinity };
			for (let run = 0; run < 5; run++) {
				best = { small: Math.min(best.small, time(small, collapse(small))), large: Math.min(best.large, time(large, collapse(large))) };
			}
			return best;
		};

		it('with finished epics folded, as the Map opens', () => {
			const result = layout(large);
			expect(result.collapsed.length).toBeGreaterThan(0);
			expectOrdersHold(result, large);
			expect(result.stats.ticks).toBeLessThanOrEqual(COLD_TICKS + REFIT_TICKS);
			const { small: s, large: l } = costs(() => ({}));
			// Linear would be 2, and a pass over every pair 4.
			expect(l / s).toBeLessThan(3.5);
			expect(l).toBeLessThan(5_000);
		}, 60_000);

		// The stress case: half again the dots of the board as it opens.
		it('with every family open, a dot per item', () => {
			const result = layout(large, open(large));
			expect(result.collapsed).toEqual([]);
			expect(result.nodes.length).toBeGreaterThan(1000);
			expectOrdersHold(result, large);
			expect(result.stats.ticks).toBeLessThanOrEqual(COLD_TICKS + REFIT_TICKS);
			const { small: s, large: l } = costs(open);
			expect(l / s).toBeLessThan(3.5);
			expect(l).toBeLessThan(10_000);
		}, 60_000);
	});
});
