import type { MapItemRow } from '@specboard/core/map-read';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardBuilder, NOW, iso, realisticBoard, syntheticBoard, type RealisticBoard } from './board-fixture';
import { ORDER_GAP } from './constants';
import { layoutMap } from './layout';
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
			if (link.state === 'removed' || (cyclic.has(row.key) && cyclic.has(link.blockerKey))) continue;
			const blocker = node.get(result.representative[link.blockerKey]!)!;
			if (blocker === blocked || blocker.hub || blocked.hub) continue;
			expect(blocked.x).toBeGreaterThanOrEqual(blocker.x + blocker.r + blocked.r + ORDER_GAP - 1e-9);
		}
	}
}

function expectNoOverlaps(result: MapLayout): void {
	const placed = result.nodes.filter((n) => !n.hub);
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			const a = placed[i]!;
			const b = placed[j]!;
			expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.key} and ${b.key}`).toBeGreaterThan((a.r + b.r) * 0.9);
		}
	}
}

/**
 * The renderer draws a region as a field around its dots, so the proxy for "inside a
 * region" is a dot's center within a member's radius plus the region's pad.
 */
function strangersInRegions(result: MapLayout): string[] {
	const node = nodesOf(result);
	const strangers: string[] = [];
	for (const region of result.regions.filter((r) => r.depth === 0)) {
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

	it('keeps dots apart', () => {
		expectNoOverlaps(result);
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
				row.workers = [{ sessionKey: 'session-new', deviceName: 'personal-laptop', client: 'claude-code', branch: null, lastWriteAt: iso(NOW) }];
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

		it('keeps the frame, so nothing rescales', () => {
			expect(after.frame).toEqual(result.frame);
			expect(after.ticks).toEqual(result.ticks);
		});

		it('still keeps every order', () => {
			expectOrdersHold(after, rows);
		});
	});
});

describe('layoutMap edge cases', () => {
	it('lays out an empty board', () => {
		const result = layout([]);
		expect(result.nodes).toEqual([]);
		expect(result.upNext).toEqual([]);
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
		picked.workers = [{ sessionKey: 's-2', deviceName: 'desk', client: 'claude-code', branch: null, lastWriteAt: iso(NOW) }];
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
		expectNoOverlaps(result);
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
		expectNoOverlaps(result);
		expect(strangersInRegions(result)).toEqual([]);
	});

	describe('lays out 1,000 items in under half a second', () => {
		const rows = syntheticBoard(1000, 7);
		// Best of three after a warm-up, so a noisy neighbor on the runner doesn't decide it.
		const bestOfThree = (collapse: Record<string, boolean>): { ms: number; result: MapLayout } => {
			layout(rows, collapse);
			let best = { ms: Infinity, result: undefined as unknown as MapLayout };
			for (let run = 0; run < 3; run++) {
				const start = globalThis.performance.now();
				const result = layout(rows, collapse);
				const ms = globalThis.performance.now() - start;
				if (ms < best.ms) best = { ms, result };
			}
			return best;
		};

		it('with finished epics folded, as the Map opens', () => {
			const { ms, result } = bestOfThree({});
			expect(result.collapsed.length).toBeGreaterThan(0);
			expectOrdersHold(result, rows);
			expect(ms).toBeLessThan(500);
		}, 30_000);

		it('with every family open, a dot per item', () => {
			const expanded = Object.fromEntries(rows.filter((r) => r.type === 'epic').map((r) => [r.key, false]));
			const { ms, result } = bestOfThree(expanded);
			expect(result.collapsed).toEqual([]);
			expect(result.nodes.length).toBeGreaterThan(1000);
			expectOrdersHold(result, rows);
			expect(ms).toBeLessThan(500);
		}, 30_000);
	});
});
