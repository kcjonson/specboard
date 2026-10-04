import { forceLink, forceSimulation, forceX, forceY } from 'd3-force';
import {
	ALPHA_FLOOR,
	CHAIN_GAP,
	CHAIN_STRENGTH,
	COLD_TICKS,
	COMPUTER_CLEARANCE,
	COMPUTER_PULL,
	COMPUTER_RADIUS,
	COMPUTER_ROW_GAP,
	COMPUTER_ROW_PULL,
	COMPUTER_X,
	CROSS_LINK_GAP,
	CROSS_LINK_STRENGTH,
	FIT_DOTS,
	FIT_MAX,
	FIT_MIN,
	FIT_TOLERANCE,
	FIT_UNIT,
	ITEM_SPREAD,
	LOCAL_ALPHA,
	LOCAL_TICKS,
	MACHINE_GAP,
	MACHINE_STRENGTH,
	MIDLINE_STRENGTH,
	MIN_HALF_HEIGHT,
	ORDER_GAP,
	PARENT_TIME_PULL,
	REFIT_ALPHA,
	REFIT_TICKS,
	REGION_BAND_GAP,
	RESERVED_STRIP,
	ROW_HEIGHT,
	SESSION_MIDLINE,
	SESSION_PULL,
	SESSION_RADIUS,
	SESSION_SPREAD,
	SESSION_X,
	TIME_PULL,
	VELOCITY_DECAY,
	WORK_GAP,
	WORK_STRENGTH,
} from './constants';
import {
	bloomWidth,
	chainRow,
	collision,
	createOrderPass,
	familyRows,
	relatedChains,
	type OrderConstraint,
	type Orders,
	type SimLink,
	type SimNode,
} from './forces';
import { stronglyConnected, topologicalOrder, type Edge } from './graph';
import { regionBands, type Band } from './bands';
import { buildModel, type MapModel, type ModelItem } from './model';
import { spacing } from './spacing';
import { createTimeScale, edgeOf, quietOf, ticksOf, timeToX } from './time-scale';
import type { MapBounds, MapLayout, MapLayoutInput, MapLayoutPrevious, MapPoint, MapTimeScale } from './types';

/** FNV-1a, folded to [0, 1): a starting height every device agrees on. */
function hashUnit(key: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) / 4_294_967_296;
}

/** The fixed-seed generator d3-force uses by default, restated so the seed is ours to see. */
function seededRandom(): () => number {
	let s = 1;
	return () => (s = (1_664_525 * s + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
}

const sessionNodeKey = (key: string): string => `session:${key}`;
const computerNodeKey = (device: string): string => `computer:${device}`;

interface Graph {
	nodes: SimNode[];
	nodeOf: Map<string, SimNode>;
	links: SimLink[];
	/** Parent hub to child. */
	familyLinks: Array<[SimNode, SimNode]>;
	chainLinks: Array<[SimNode, SimNode]>;
	chainGroups: Array<[SimNode[], SimNode[]]>;
	bands: Band[];
	orders: Orders;
}

function buildGraph(model: MapModel, scale: MapTimeScale): Graph {
	const nodes: SimNode[] = [];
	const nodeOf = new Map<string, SimNode>();
	const add = (node: Omit<SimNode, 'x' | 'y' | 'vx' | 'vy'>): void => {
		const full: SimNode = { ...node, x: node.tx, y: node.ty, vx: 0, vy: 0 };
		nodes.push(full);
		nodeOf.set(full.key, full);
	};

	for (const item of model.items) {
		if (item.rep !== item) continue;
		add({
			key: item.key,
			kind: 'item',
			phase: item.phase,
			r: item.radius,
			hub: item.hub,
			tx: timeToX(scale, item.anchor),
			kx: item.hub ? 0 : TIME_PULL * (item.children.length ? PARENT_TIME_PULL : 1),
			ty: 0,
			ky: MIDLINE_STRENGTH,
			family: item.family,
		});
	}
	model.computers.forEach((computer, i) => {
		add({
			key: computerNodeKey(computer.device),
			kind: 'computer',
			phase: null,
			r: COMPUTER_RADIUS,
			hub: false,
			tx: scale.unit * COMPUTER_X,
			kx: COMPUTER_PULL,
			ty: (i - (model.computers.length - 1) / 2) * COMPUTER_ROW_GAP,
			ky: COMPUTER_ROW_PULL,
			family: undefined,
		});
	});
	for (const session of model.sessions) {
		add({
			key: sessionNodeKey(session.key),
			kind: 'session',
			phase: null,
			r: SESSION_RADIUS,
			hub: false,
			tx: scale.unit * SESSION_X,
			kx: SESSION_PULL,
			ty: 0,
			ky: SESSION_MIDLINE,
			family: undefined,
		});
	}

	const repNode = (item: ModelItem): SimNode => nodeOf.get(item.rep.key)!;
	const links: SimLink[] = [];
	const linked = new Set<string>();
	const pairId = (a: SimNode, b: SimNode): string => (a.key < b.key ? `${a.key}\n${b.key}` : `${b.key}\n${a.key}`);
	const link = (source: SimNode, target: SimNode, gap: number, strength: number): void => {
		if (source === target) return;
		const id = pairId(source, target);
		if (linked.has(id)) return;
		linked.add(id);
		const distance = source.hub || target.hub ? 0 : source.r + target.r + gap;
		links.push({ source, target, distance, strength });
	};

	// Strongest first: a pair keeps the first link it gets. Family links pull across time
	// only (see familyRows), so they're kept apart from the springs, but they still claim
	// their pair.
	const familyLinks: Array<[SimNode, SimNode]> = [];
	for (const item of model.items) {
		if (!item.hub) continue;
		for (const child of item.children) {
			if (model.chainBlocked.has(child)) continue;
			const pair: [SimNode, SimNode] = [repNode(item), repNode(child)];
			linked.add(pairId(...pair));
			familyLinks.push(pair);
		}
	}
	const chainLinks: Array<[SimNode, SimNode]> = [];
	for (const chain of model.chains) {
		for (const edge of chain.edges) {
			const pair: [SimNode, SimNode] = [repNode(edge.blocker), repNode(edge.blocked)];
			link(pair[0], pair[1], CHAIN_GAP, CHAIN_STRENGTH);
			chainLinks.push(pair);
		}
	}
	for (const edge of model.edges) link(repNode(edge.blocker), repNode(edge.blocked), CROSS_LINK_GAP, CROSS_LINK_STRENGTH);
	for (const item of model.items) {
		const from = item.row.discoveredFromKey ? model.byKey.get(item.row.discoveredFromKey) : undefined;
		if (from) link(repNode(from), repNode(item), CROSS_LINK_GAP, CROSS_LINK_STRENGTH);
	}
	for (const session of model.sessions) {
		const sessionNode = nodeOf.get(sessionNodeKey(session.key))!;
		link(nodeOf.get(computerNodeKey(session.device))!, sessionNode, MACHINE_GAP, MACHINE_STRENGTH);
		for (const item of session.items) link(sessionNode, repNode(item), WORK_GAP, WORK_STRENGTH);
	}

	const chainDots = model.chains.map((chain) => chain.items.map(repNode).filter((n) => !n.hub));
	const chainGroups = model.relatedChains
		.map(([a, b]): [SimNode[], SimNode[]] => [chainDots[a]!, chainDots[b]!])
		.filter(([a, b]) => a.length > 0 && b.length > 0);

	const done = model.items
		.filter((item) => item.rep === item && !item.hub && item.phase === 'done')
		.sort((a, b) => a.completion - b.completion || a.index - b.index)
		.map(repNode);
	// The date order holds in-progress and in-review work past the last completion; a
	// started hold is in flight for the counts but drifts with its moment like the rest.
	const inFlight = stagger(
		model.items
			.filter((item) => item.rep === item && !item.hub && (item.row.status === 'in_progress' || item.row.status === 'in_review'))
			.map(repNode),
	);

	return { nodes, nodeOf, links, familyLinks, chainLinks, chainGroups, bands: bandsOf(model, repNode), orders: { done, inFlight, dependencies: dependenciesOf(model, nodes, repNode), gap: ORDER_GAP } };
}

/**
 * Each region's center and dots, for keeping sibling regions apart. A parent with
 * regions nested in it also gets a band of its own direct children, a sibling to
 * those regions: a nested region's outline has to stay inside its parent's, and that
 * holds when the parent's own children keep a row of their own rather than sitting
 * between the nested region's dots.
 */
function bandsOf(model: MapModel, repNode: (item: ModelItem) => SimNode): Band[] {
	const hubs = model.items.filter((item) => item.hub);
	const index = new Map(hubs.map((item, i) => [item, i]));
	const bands: Band[] = hubs.map((item) => ({ hubs: [repNode(item)], members: [], parent: item.parent ? index.get(item.parent)! : -1 }));
	for (const item of model.items) {
		if (item.rep !== item) continue;
		for (let p = item.parent; p; p = p.parent) {
			const band = bands[index.get(p)!]!;
			if (item.hub) band.hubs.push(repNode(item));
			else band.members.push(repNode(item));
		}
	}
	for (const hub of hubs) {
		if (!hub.children.some((child) => child.hub)) continue;
		const own = hub.children.filter((child) => !child.hub).map(repNode);
		if (own.length) bands.push({ hubs: [], members: own, parent: index.get(hub)! });
	}
	return bands;
}

/**
 * Until it's done, an item sits right of each blocker. Cycles are exempt, at the item
 * level and again between dots, since collapse can fold two ends of a path into one
 * cycle. The result is sorted so walking it once settles every constraint.
 */
function dependenciesOf(model: MapModel, nodes: SimNode[], repNode: (item: ModelItem) => SimNode): OrderConstraint[] {
	const index = new Map(nodes.map((n, i) => [n, i]));
	const pairs = new Map<string, OrderConstraint>();
	for (const edge of model.edges) {
		if (edge.cyclic) continue;
		const a = repNode(edge.blocker);
		const b = repNode(edge.blocked);
		// Whether the order applies is the blocked item's call, not its dot's: a done child
		// folded into an open parent doesn't drag the parent right of its old blockers.
		if (edge.blocked.phase === 'done' || a === b || a.hub || b.hub || b.phase === 'done') continue;
		const id = `${a.key}\n${b.key}`;
		if (!pairs.has(id)) pairs.set(id, { a, b, gap: a.r + b.r + ORDER_GAP, lead: 0 });
	}
	const candidates = [...pairs.values()];
	const toEdge = (c: OrderConstraint): Edge => [index.get(c.a)!, index.get(c.b)!];
	const { component, size } = stronglyConnected(nodes.length, candidates.map(toEdge));
	const acyclic = candidates.filter((c) => {
		const ca = component[index.get(c.a)!]!;
		return ca !== component[index.get(c.b)!] || size[ca] === 1;
	});
	const position = new Int32Array(nodes.length);
	topologicalOrder(nodes.length, acyclic.map(toEdge)).forEach((v, i) => (position[v] = i));
	// A blocker's own constraints all come from earlier in the order, so it has settled
	// by the time the walk reaches what it blocks.
	acyclic.sort((x, y) => position[index.get(x.a)!]! - position[index.get(y.a)!]!);
	for (let start = 0; start < acyclic.length; ) {
		let end = start;
		while (end < acyclic.length && acyclic[end]!.a === acyclic[start]!.a) end++;
		const group = acyclic.slice(start, end);
		const leads = stagger(group.map((c) => c.b));
		group.forEach((c, i) => (c.lead = leads[i]!.lead));
		start = end;
	}
	return acyclic;
}

/**
 * A floor is a minimum, not a destination. When every dot one floor holds shares it,
 * the dots pressed against it (pulled left by their families, or by a moment the floor
 * overrules) line up on one x, a fence. So each dot's minimum leads the floor by its
 * own amount, spread evenly over the width the group would bloom to, in time order
 * with ties broken by a hash of the key: pressed against its floor, the group keeps
 * the shape of a cloud. Returns the dots in the order given, with their leads.
 */
function stagger(dots: SimNode[]): Array<{ node: SimNode; lead: number }> {
	const width = 2 * bloomWidth(dots.length);
	const ranked = [...dots].sort((a, b) => a.tx - b.tx || hashUnit(a.key) - hashUnit(b.key));
	const rank = new Map(ranked.map((n, i) => [n, i]));
	const step = dots.length > 1 ? width / (dots.length - 1) : 0;
	return dots.map((node) => ({ node, lead: rank.get(node)! * step }));
}

/** Raise time-pull targets to the orders before the run, so the pull and the orders agree. */
function raiseTargets(graph: Graph, scale: MapTimeScale): void {
	const { done, inFlight, dependencies, gap } = graph.orders;
	if (done.length) {
		let edge = -Infinity;
		for (const n of done) edge = Math.max(edge, n.tx + n.r);
		for (const { node, lead } of inFlight) node.tx = Math.max(node.tx, edge + node.r + gap + lead);
	}
	for (const { a, b, gap: min, lead } of dependencies) b.tx = Math.max(b.tx, a.tx + min + lead);
	let rightmost = 0;
	for (const n of graph.nodes) if (n.kind === 'item') rightmost = Math.max(rightmost, n.tx);
	for (const n of graph.nodes) if (n.kind === 'computer') n.tx = Math.max(scale.unit * COMPUTER_X, rightmost + COMPUTER_CLEARANCE);
}

/** Runs the forces with the orders restored after every tick; returns the last tick's largest move. */
function simulate(graph: Graph, ticks: number, alpha: number): number {
	const simulation = forceSimulation<SimNode>(graph.nodes)
		.stop()
		.randomSource(seededRandom())
		.alpha(alpha)
		.alphaMin(0)
		.alphaTarget(0)
		.alphaDecay(1 - Math.pow(ALPHA_FLOOR, 1 / ticks))
		.velocityDecay(VELOCITY_DECAY)
		.force('time', forceX<SimNode>((n) => n.tx).strength((n) => n.kx))
		.force('midline', forceY<SimNode>((n) => n.ty).strength((n) => n.ky))
		.force('links', forceLink<SimNode, SimLink>(graph.links).distance((l) => l.distance).strength((l) => l.strength))
		.force('family', familyRows(graph.familyLinks))
		.force('chainRow', chainRow(graph.chainLinks))
		.force('relatedChains', relatedChains(graph.chainGroups))
		.force('bands', regionBands(graph.bands))
		.force('spacing', spacing())
		.force('collision', collision());
	const enforce = createOrderPass(graph.orders);
	const before = new Float64Array(graph.nodes.length * 2);
	let settle = 0;
	for (let tick = 0; tick < ticks; tick++) {
		const last = tick === ticks - 1;
		if (last) graph.nodes.forEach((n, i) => ((before[2 * i] = n.x), (before[2 * i + 1] = n.y)));
		simulation.tick();
		enforce();
		if (last) {
			graph.nodes.forEach((n, i) => {
				settle = Math.max(settle, Math.abs(n.x - before[2 * i]!), Math.abs(n.y - before[2 * i + 1]!));
			});
		}
	}
	return settle;
}

function boundsOf(nodes: readonly SimNode[], unit: number): MapBounds {
	const bounds = { minX: Infinity, maxX: unit * RESERVED_STRIP, minY: -MIN_HALF_HEIGHT, maxY: MIN_HALF_HEIGHT };
	for (const n of nodes) {
		bounds.minX = Math.min(bounds.minX, n.x - n.r);
		bounds.maxX = Math.max(bounds.maxX, n.x + n.r);
		bounds.minY = Math.min(bounds.minY, n.y - n.r);
		bounds.maxY = Math.max(bounds.maxY, n.y + n.r);
	}
	if (!Number.isFinite(bounds.minX)) bounds.minX = 0;
	return bounds;
}

/** A cold start: every dot at its time target, at a height hashed from its key. */
function seedCold(graph: Graph): void {
	for (const n of graph.nodes) {
		n.x = n.tx;
		if (n.kind === 'item') n.y = (hashUnit(n.key) - 0.5) * ITEM_SPREAD;
		else if (n.kind === 'session') n.y = (hashUnit(n.key) - 0.5) * SESSION_SPREAD;
		else n.y = n.ty;
	}
}

interface Settled {
	graph: Graph;
	scale: MapTimeScale;
	bounds: MapBounds;
	ticks: number;
	settle: number;
}

/**
 * How tall the stacked rows of the busiest stretch of time will stand: top-level
 * families sharing time sit one above another (see regionBands), so the most families
 * alive at any one moment, each a row plus the gap between rows, is the Map's least
 * height. Measured on the scale's unit width of 1, since it doesn't depend on the width.
 */
function stackedHeight(model: MapModel, unitScale: MapTimeScale): number {
	const spans = new Map<ModelItem, { from: number; to: number }>();
	for (const item of model.items) {
		if (item.rep !== item || item.hub || !item.parent) continue;
		let top = item.parent;
		while (top.parent) top = top.parent;
		const x = timeToX(unitScale, item.anchor);
		const span = spans.get(top);
		if (span) {
			span.from = Math.min(span.from, x);
			span.to = Math.max(span.to, x);
		} else spans.set(top, { from: x, to: x });
	}
	const events = [...spans.values()].flatMap(({ from, to }): Array<[number, number]> => [
		[from, 1],
		[to, -1],
	]);
	events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	let alive = 0;
	let most = 0;
	for (const [, change] of events) {
		alive += change;
		most = Math.max(most, alive);
	}
	return most * (ROW_HEIGHT + REGION_BAND_GAP);
}

/**
 * A cold start, fitted in two passes so the settled Map matches the canvas: lay out
 * at a trial width, then rescale time so the width the dots take matches the height
 * they took. A settled Map's area grows with its dots, so the trial width grows with
 * the square root of the dot count and a big board's trial lands near its fit. The
 * second pass starts from the first, stretched to the new width, and runs as a short
 * low-energy pass rather than a second cold start, which would double the cost for a
 * result the stretch already lands near.
 */
function coldLayout(model: MapModel, edge: number, aspect: number): Settled {
	const dotCount = model.items.filter((item) => item.rep === item && !item.hub).length;
	const unitScale = createTimeScale(edge, model.times, 1);
	// The Map's width per unit, as boundsOf measures it: the span of time plus the reserved strip past now.
	const unitWidth = -timeToX(unitScale, model.times[0] ?? edge) + RESERVED_STRIP;
	const trialUnit = Math.max(FIT_UNIT * aspect * Math.sqrt(Math.max(1, dotCount / FIT_DOTS)), (aspect * stackedHeight(model, unitScale)) / unitWidth);
	const trial = createTimeScale(edge, model.times, trialUnit);
	const first = buildGraph(model, trial);
	raiseTargets(first, trial);
	seedCold(first);
	const firstSettle = simulate(first, COLD_TICKS, 1);
	const firstBounds = boundsOf(first.nodes, trialUnit);
	const want = (firstBounds.maxY - firstBounds.minY) * aspect;
	const unit = trialUnit * Math.max(FIT_MIN, Math.min(FIT_MAX, want / Math.max(1, firstBounds.maxX - firstBounds.minX)));
	if (Math.abs(unit - trialUnit) <= FIT_TOLERANCE * trialUnit) {
		return { graph: first, scale: trial, bounds: firstBounds, ticks: COLD_TICKS, settle: firstSettle };
	}

	const scale = createTimeScale(edge, model.times, unit);
	const graph = buildGraph(model, scale);
	raiseTargets(graph, scale);
	const stretch = unit / trialUnit;
	for (const n of graph.nodes) {
		const from = first.nodeOf.get(n.key)!;
		n.x = from.x * stretch;
		n.y = from.y;
	}
	const settle = simulate(graph, REFIT_TICKS, REFIT_ALPHA);
	return { graph, scale, bounds: boundsOf(graph.nodes, unit), ticks: COLD_TICKS + REFIT_TICKS, settle };
}

/**
 * A local pass: start from the previous positions, let only the changed items, their
 * sessions and computers, new nodes, and anything within two links of them move, and
 * keep the previous frame so nothing rescales. The orders still hold everywhere.
 */
function localLayout(model: MapModel, previous: MapLayoutPrevious): Settled {
	const { scale } = previous.frame;
	const graph = buildGraph(model, scale);
	raiseTargets(graph, scale);
	const before = previous.positions;
	const near = (point: MapPoint | undefined, dx: number, dy: number): MapPoint | undefined =>
		point && { x: point.x + dx, y: point.y + dy };

	const mobile = new Set<SimNode>();
	for (const key of previous.changed) {
		const item = model.byKey.get(key);
		if (item) mobile.add(graph.nodeOf.get(item.rep.key)!);
	}
	for (const session of model.sessions) {
		if (!session.items.some((item) => mobile.has(graph.nodeOf.get(item.rep.key)!))) continue;
		mobile.add(graph.nodeOf.get(sessionNodeKey(session.key))!);
		mobile.add(graph.nodeOf.get(computerNodeKey(session.device))!);
	}
	for (const n of graph.nodes) if (!before[n.key]) mobile.add(n);
	for (let hop = 0; hop < 2; hop++) {
		const reached: SimNode[] = [];
		for (const [source, target] of [...graph.links.map((l): [SimNode, SimNode] => [l.source, l.target]), ...graph.familyLinks]) {
			if (mobile.has(source) && !mobile.has(target)) reached.push(target);
			if (mobile.has(target) && !mobile.has(source)) reached.push(source);
		}
		for (const n of reached) mobile.add(n);
	}
	// Computer rows and their clearance past the work are set across all computers, so
	// one arriving moves every computer's target; they settle without pulling others along.
	for (const n of graph.nodes) if (n.kind === 'computer') mobile.add(n);

	for (const n of graph.nodes) {
		let start = before[n.key];
		if (!start && n.kind === 'item') {
			const parent = model.byKey.get(n.key)!.parent;
			start = parent ? near(before[parent.rep.key], 8, 8) : undefined;
		} else if (!start && n.kind === 'session') {
			const first = model.sessions.find((s) => sessionNodeKey(s.key) === n.key)!.items[0];
			start = first ? near(before[first.rep.key], 12, 0) : undefined;
		}
		n.x = start?.x ?? n.tx;
		n.y = start?.y ?? (n.kind === 'computer' ? n.ty : (hashUnit(n.key) - 0.5) * (n.kind === 'item' ? ITEM_SPREAD : SESSION_SPREAD));
		if (!mobile.has(n)) {
			n.fx = n.x;
			n.fy = n.y;
		}
	}
	return { graph, ...previous.frame, ticks: LOCAL_TICKS, settle: simulate(graph, LOCAL_TICKS, LOCAL_ALPHA) };
}

/** Lays out the Map: positions for every visible node, the time scale, and the sets the renderer draws from. */
export function layoutMap(input: MapLayoutInput): MapLayout {
	const model = buildModel(input.rows, input.now, input.collapse);
	const quiet = quietOf(model.newest, input.now);
	const edge = edgeOf(model.newest, input.now);
	// A local pass keeps the frame, which only holds while the edge does: a live board's
	// edge is frozen at the last pass's now, a quiet board's sits at its last activity.
	const frame = input.previous?.frame;
	const previous = frame && frame.quiet === (quiet !== null) && (!frame.quiet || frame.scale.edge === edge) ? input.previous : undefined;
	const { graph, scale, bounds, ticks, settle } = previous ? localLayout(model, previous) : coldLayout(model, edge, input.aspect);

	const phases: MapLayout['phases'] = {};
	const representative: MapLayout['representative'] = {};
	for (const item of model.items) {
		phases[item.key] = item.phase;
		representative[item.key] = item.rep.key;
	}
	const regionOf = new Map(
		model.items
			.filter((item) => item.hub)
			.map((item) => {
				let depth = 0;
				for (let p = item.parent; p; p = p.parent) depth++;
				return [item, { key: item.key, parentKey: item.parent?.key ?? null, depth, members: [] as string[] }];
			}),
	);
	for (const item of model.items) {
		if (item.rep !== item || item.hub) continue;
		for (let p = item.parent; p; p = p.parent) regionOf.get(p)?.members.push(item.key);
	}

	return {
		nodes: graph.nodes.map((n) => ({ key: n.key, kind: n.kind, x: n.x, y: n.y, r: n.r, hub: n.hub })),
		frame: { scale, bounds, quiet: quiet !== null },
		ticks: ticksOf(scale),
		quiet,
		phases,
		upNext: model.upNext,
		planOrder: model.planOrder,
		representative,
		collapsed: model.items.filter((item) => item.rep === item && item.collapsed).map((item) => item.key),
		regions: [...regionOf.values()],
		chains: model.chains.map((chain) => ({
			parentKey: chain.parent.key,
			items: chain.items.map((item) => item.key),
			links: chain.edges.map((e) => ({ blocker: e.blocker.key, blocked: e.blocked.key, satisfied: e.satisfied })),
		})),
		deadlocked: model.deadlocked,
		sessions: model.sessions.map((s) => ({
			key: s.key,
			device: s.device,
			client: s.client,
			lastWriteAt: s.lastWriteAt,
			number: s.number,
			items: s.items.map((item) => item.key),
		})),
		computers: model.computers.map((c) => ({ device: c.device, sessions: c.sessions.map((s) => s.key) })),
		stats: { ticks, settle },
	};
}
