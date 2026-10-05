import type { Force, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { MapNodeKind, MapPhase } from './types';
import { CellIndex } from './grid';
import {
	CHAIN_ROW_STRENGTH,
	COLLISION_PAD,
	COLLISION_STRENGTH,
	FAMILY_STRENGTH,
	MIDLINE_STRENGTH,
	ORDER_EPSILON,
	RELATED_CHAINS_GAP,
	RELATED_CHAINS_STRENGTH,
	REPULSION,
	TIME_PULL,
	SESSION_PULL_CAP,
	WORK_ITEM_SHARE,
	WORK_STRENGTH,
	WORK_PULL_CAP,
} from './constants';

export interface SimNode extends SimulationNodeDatum {
	key: string;
	kind: MapNodeKind;
	/** The item's phase, null for sessions and computers. */
	phase: MapPhase | null;
	r: number;
	hub: boolean;
	/** Time pull target and strength, midline (or computer row) target and strength. */
	tx: number;
	kx: number;
	ty: number;
	ky: number;
	/** The region a dot is drawn in, null for a loose dot, undefined for sessions and computers. */
	family: string | null | undefined;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
	source: SimNode;
	target: SimNode;
	distance: number;
	strength: number;
}

/**
 * Dots never overlap: radii plus a pad, resolved on predicted positions with the
 * larger dot moving less, as d3's forceCollide does, over a grid instead of a quadtree.
 */
export function collision(): Force<SimNode, SimLink> {
	let nodes: SimNode[] = [];
	let random!: () => number;
	let radii = new Float64Array(0);
	let xs = new Float64Array(0);
	let ys = new Float64Array(0);
	let vxs = new Float64Array(0);
	let vys = new Float64Array(0);
	let sortedRadius = new Float64Array(0);
	let reach = 0;
	const grid = new CellIndex();

	const force = (): void => {
		const count = nodes.length;
		if (count < 2) return;
		for (let i = 0; i < count; i++) {
			const n = nodes[i]!;
			xs[i] = n.x + n.vx;
			ys[i] = n.y + n.vy;
		}
		grid.build(xs, ys, count, reach);
		const { columns, rows, start, x, y, point } = grid;
		const rs = sortedRadius;
		const vx = vxs;
		const vy = vys;
		for (let k = 0; k < count; k++) {
			const n = nodes[point[k]!]!;
			rs[k] = radii[point[k]!]!;
			// Sorted positions become current ones; velocities move as pairs resolve.
			vx[k] = n.vx;
			vy[k] = n.vy;
			x[k]! -= n.vx;
			y[k]! -= n.vy;
		}
		for (let cy = 0; cy < rows; cy++) {
			for (let cx = 0; cx < columns; cx++) {
				const c = cx + cy * columns;
				const end = start[c + 1]!;
				const rightEnd = cx + 1 < columns ? start[c + 2]! : end;
				const belowFrom = cy + 1 < rows ? start[Math.max(0, cx - 1) + (cy + 1) * columns]! : 0;
				const belowTo = cy + 1 < rows ? start[Math.min(columns - 1, cx + 1) + (cy + 1) * columns + 1]! : 0;
				for (let k = start[c]!; k < end; k++) {
					const rk = rs[k]!;
					for (let pass = 0; pass < 2; pass++) {
						const from = pass === 0 ? k + 1 : belowFrom;
						const to = pass === 0 ? rightEnd : belowTo;
						for (let m = from; m < to; m++) {
							const rm = rs[m]!;
							const rr = rk + rm;
							let dx = x[k]! + vx[k]! - x[m]! - vx[m]!;
							let dy = y[k]! + vy[k]! - y[m]! - vy[m]!;
							const l2 = dx * dx + dy * dy;
							if (l2 >= rr * rr) continue;
							let length = Math.sqrt(l2);
							if (length < 1e-6) {
								dx = random() - 0.5;
								dy = random() - 0.5;
								length = Math.sqrt(dx * dx + dy * dy);
							}
							const push = ((rr - length) / length) * COLLISION_STRENGTH;
							dx *= push;
							dy *= push;
							const share = (rm * rm) / (rk * rk + rm * rm);
							vx[k]! += dx * share;
							vy[k]! += dy * share;
							vx[m]! -= dx * (1 - share);
							vy[m]! -= dy * (1 - share);
						}
					}
				}
			}
		}
		for (let k = 0; k < count; k++) {
			const n = nodes[point[k]!]!;
			n.vx = vx[k]!;
			n.vy = vy[k]!;
		}
	};
	force.initialize = (all: SimNode[], source: () => number): void => {
		nodes = all.filter((n) => !n.hub);
		random = source;
		radii = Float64Array.from(nodes, (n) => n.r + COLLISION_PAD / 2);
		reach = 2 * radii.reduce((max, r) => Math.max(max, r), 0);
		xs = new Float64Array(nodes.length);
		ys = new Float64Array(nodes.length);
		vxs = new Float64Array(nodes.length);
		vys = new Float64Array(nodes.length);
		sortedRadius = new Float64Array(nodes.length);
	};
	return force;
}

/**
 * A parent's unseen center holds its children with a spring of rest length 0, but a
 * done child only across time: its x is the completion order's, so finished work stays
 * where it was done and an epic stretches back through it. Pulling done children along
 * time too packed a long-running family against that order, which then pooled whole
 * runs of done work, theirs and their neighbors', onto one x. The center follows its
 * children both ways.
 */
export function familyRows(links: ReadonlyArray<readonly [hub: SimNode, child: SimNode]>): Force<SimNode, SimLink> {
	const children = new Map<SimNode, number>();
	for (const [hub] of links) children.set(hub, (children.get(hub) ?? 0) + 1);
	return (alpha: number): void => {
		const k = alpha * FAMILY_STRENGTH;
		for (const [hub, child] of links) {
			const dy = child.y - hub.y;
			child.vy -= dy * k;
			if (child.phase !== 'done') child.vx -= (child.x - hub.x) * k;
			const share = k / children.get(hub)!;
			hub.vx += (child.x - hub.x) * share;
			hub.vy += dy * share;
		}
	};
}

/**
 * A session pulls each item it is working on with a spring of rest length `gap`, but the pull
 * stops growing at WORK_PULL_CAP, so an item far from its session is held by its family and
 * only a close one is gathered. The items' pulls on the session are summed and then capped as
 * a whole: its computer holds it, and a session that works across the Map stays beside its
 * computer instead of being dragged out of its cluster.
 */
export function workPull(pairs: ReadonlyArray<readonly [session: SimNode, item: SimNode, rest: number]>): Force<SimNode, SimLink> {
	const sessions = [...new Set(pairs.map(([session]) => session))];
	const slot = new Map(sessions.map((s, i) => [s, i]));
	const px = new Float64Array(sessions.length);
	const py = new Float64Array(sessions.length);
	return (alpha: number): void => {
		px.fill(0);
		py.fill(0);
		for (const [session, item, rest] of pairs) {
			const dx = item.x + item.vx - session.x - session.vx;
			const dy = item.y + item.vy - session.y - session.vy;
			const d = Math.hypot(dx, dy) || 1e-6;
			if (d <= rest) continue;
			const pull = (Math.min(WORK_STRENGTH * (d - rest), WORK_PULL_CAP) * alpha) / d;
			item.vx -= dx * pull * WORK_ITEM_SHARE;
			item.vy -= dy * pull * WORK_ITEM_SHARE;
			const i = slot.get(session)!;
			px[i]! += dx * pull * (1 - WORK_ITEM_SHARE);
			py[i]! += dy * pull * (1 - WORK_ITEM_SHARE);
		}
		sessions.forEach((session, i) => {
			const length = Math.hypot(px[i]!, py[i]!);
			const scale = length > SESSION_PULL_CAP * alpha ? (SESSION_PULL_CAP * alpha) / length : 1;
			session.vx += px[i]! * scale;
			session.vy += py[i]! * scale;
		});
	};
}

/**
 * A chain's dots are pulled to the chain's common height, so it reads as a level row. The
 * pull toward the blocker alone left a chain sloping about 15 units a step: the other forces
 * on each dot (neighbors' repulsion, the midline, the row apart from a related chain) bias
 * them differently, and nothing tied a chain's far end to its near one. The pulls sum to
 * zero, so a chain doesn't drift.
 */
export function chainRow(chains: ReadonlyArray<readonly SimNode[]>): Force<SimNode, SimLink> {
	return (alpha: number): void => {
		for (const dots of chains) {
			if (dots.length < 2) continue;
			let sum = 0;
			for (const n of dots) sum += n.y;
			const mean = sum / dots.length;
			const k = alpha * CHAIN_ROW_STRENGTH;
			for (const n of dots) n.vy += (mean - n.y) * k;
		}
	};
}

/** Chains that relate pull toward one row apart: their largest radii plus a gap. */
export function relatedChains(pairs: ReadonlyArray<readonly [SimNode[], SimNode[]]>): Force<SimNode, SimLink> {
	return (alpha: number): void => {
		for (const [first, second] of pairs) {
			let y1 = 0;
			let y2 = 0;
			let r1 = 0;
			let r2 = 0;
			for (const n of first) {
				y1 += n.y;
				r1 = Math.max(r1, n.r);
			}
			for (const n of second) {
				y2 += n.y;
				r2 = Math.max(r2, n.r);
			}
			const dy = y2 / second.length - y1 / first.length;
			const want = r1 + r2 + RELATED_CHAINS_GAP;
			const f = ((Math.abs(dy) < 1e-3 ? 1 : Math.sign(dy)) * want - dy) * alpha * RELATED_CHAINS_STRENGTH;
			for (const n of first) n.vy -= f / 2;
			for (const n of second) n.vy += f / 2;
		}
	};
}

export interface OrderConstraint {
	/** The blocker. */
	a: SimNode;
	/** The unfinished item it blocks, held at least `gap + lead` to its right. */
	b: SimNode;
	gap: number;
	/** How far past the plain gap this dot's minimum sits, so a blocker's dependents don't fence. */
	lead: number;
}

export interface Orders {
	/** Done dots in completion order. */
	done: SimNode[];
	/** In-progress and in-review dots, each held `lead` further past the last completion than the plain floor. */
	inFlight: Array<{ node: SimNode; lead: number }>;
	/** Sorted so a walk in this order settles every constraint in one pass. */
	dependencies: OrderConstraint[];
	gap: number;
}

function place(n: SimNode, x: number): void {
	n.x = x;
	// Orders outrank pins: a pinned dot an order moves stays where the order put it.
	if (n.fx != null) n.fx = x;
}

/**
 * Half the width a group of dots takes when one target pulls them all. Repulsion
 * falls off as 1/d, so a group under the time pull and the midline settles as a
 * uniformly filled ellipse whose half-width is sqrt(2 * Q * ky / (kx * (kx + ky))),
 * Q being the group's total repulsion. A single dot has none.
 */
export function bloomWidth(count: number): number {
	return Math.sqrt((2 * REPULSION * Math.max(0, count - 1) * MIDLINE_STRENGTH) / (TIME_PULL * (TIME_PULL + MIDLINE_STRENGTH)));
}

/**
 * Restores the date and dependency orders after a tick with the least movement:
 * pool adjacent violators over done items (the least-squares fix for an order),
 * hold in-flight items past the last completion, then walk the dependencies.
 * Each step only pushes the items the next one reads in a direction it accepts,
 * so one pass leaves every order intact.
 */
export function createOrderPass(orders: Orders): () => void {
	const { done, inFlight, dependencies, gap } = orders;
	const poolStart = new Int32Array(done.length);
	const poolCount = new Int32Array(done.length);
	const poolSum = new Float64Array(done.length);
	const bloom = Float64Array.from({ length: done.length + 1 }, (_, n) => bloomWidth(n));

	return (): void => {
		let pools = 0;
		for (let i = 0; i < done.length; i++) {
			let start = i;
			let count = 1;
			let sum = done[i]!.x;
			// A pool fans out over its bloom width around its mean, so it absorbs a neighbor
			// closer than the fan's step would hold them, not just one out of order.
			while (pools > 0) {
				const prevCount = poolCount[pools - 1]!;
				const merged = prevCount + count;
				const gap = sum / count - bloom[count]! - (poolSum[pools - 1]! / prevCount + bloom[prevCount]!);
				if (gap >= (2 * bloom[merged]!) / (merged - 1)) break;
				pools--;
				start = poolStart[pools]!;
				count += poolCount[pools]!;
				sum += poolSum[pools]!;
			}
			poolStart[pools] = start;
			poolCount[pools] = count;
			poolSum[pools] = sum;
			pools++;
		}
		for (let p = 0; p < pools; p++) {
			const count = poolCount[p]!;
			if (count === 1) continue;
			const mean = poolSum[p]! / count;
			const step = (2 * bloom[count]!) / (count - 1);
			for (let k = 0; k < count; k++) {
				const n = done[poolStart[p]! + k]!;
				place(n, mean + (k - (count - 1) / 2) * step);
				n.vx = 0;
			}
		}
		for (let i = 1; i < done.length; i++) {
			const min = done[i - 1]!.x + ORDER_EPSILON;
			if (done[i]!.x < min) place(done[i]!, min);
		}

		if (done.length) {
			let edge = -Infinity;
			for (const n of done) edge = Math.max(edge, n.x + n.r);
			for (const { node: n, lead } of inFlight) {
				const min = edge + n.r + gap + lead;
				if (n.x < min) {
					place(n, min);
					if (n.vx < 0) n.vx = 0;
				}
			}
		}

		for (const { a, b, gap: min, lead } of dependencies) {
			if (b.x < a.x + min + lead) {
				place(b, a.x + min + lead);
				if (b.vx < 0) b.vx = 0;
			}
		}
	};
}
