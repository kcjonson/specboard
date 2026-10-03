import type { MapItemRow } from '@specboard/core/map-read';
import {
	IN_FLIGHT_PARENT_SCALE,
	IN_FLIGHT_RADIUS,
	LEAF_RADIUS,
	PARENT_RADIUS_BASE,
	PARENT_RADIUS_GROWTH,
	SESSION_LIVE,
	UP_NEXT_COUNT,
} from './constants';
import { stronglyConnected, topologicalOrder, type Edge } from './graph';
import type { MapPhase } from './types';

/**
 * The read, resolved into the tree, phases, collapse, chains, and sessions the
 * simulation and the renderer both need. Everything here is position-free.
 */

export interface ModelItem {
	row: MapItemRow;
	key: string;
	/** Position in key order, which every iteration follows so the result can't depend on row order. */
	index: number;
	parent: ModelItem | null;
	/** By rank. */
	children: ModelItem[];
	phase: MapPhase;
	descendants: number;
	/** Newest anchor anywhere in the subtree, epoch ms. */
	anchor: number;
	/** Completion order key for a done item. */
	completion: number;
	/** Folds its children into one dot. */
	collapsed: boolean;
	/** The visible item that draws this one: itself, or its outermost collapsed ancestor. */
	rep: ModelItem;
	/** Visible with visible children: an unseen center for a region. */
	hub: boolean;
	/** Top-level ancestor's key for a dot inside a region, null for a loose dot. */
	family: string | null;
	radius: number;
}

export interface BlockerEdge {
	blocker: ModelItem;
	blocked: ModelItem;
	satisfied: boolean;
	/** Inside a blocker cycle, which can't be ordered. */
	cyclic: boolean;
}

export interface ChainGroup {
	parent: ModelItem;
	/** In dependency order. */
	items: ModelItem[];
	edges: BlockerEdge[];
}

export interface SessionModel {
	key: string;
	device: string;
	client: string | null;
	lastWriteAt: number;
	number: number;
	items: ModelItem[];
}

export interface ComputerModel {
	device: string;
	sessions: SessionModel[];
}

export interface MapModel {
	/** In key order. */
	items: ModelItem[];
	byKey: Map<string, ModelItem>;
	edges: BlockerEdge[];
	chains: ChainGroup[];
	/** Items whose chain link replaces their parent link. */
	chainBlocked: Set<ModelItem>;
	/** Pairs of indexes into `chains` that pull toward one row apart. */
	relatedChains: Array<[number, number]>;
	upNext: string[];
	planOrder: string[];
	deadlocked: string[];
	sessions: SessionModel[];
	computers: ComputerModel[];
	/** Newest anchor on the board, -Infinity when it's empty. */
	newest: number;
	/** Every subtree anchor, ascending. */
	times: number[];
}

/** Orders `SPE-9` before `SPE-10`. */
export function compareKeys(a: string, b: string): number {
	const da = a.lastIndexOf('-');
	const db = b.lastIndexOf('-');
	const pa = a.slice(0, da);
	const pb = b.slice(0, db);
	if (pa !== pb) return pa < pb ? -1 : 1;
	const na = Number(a.slice(da + 1));
	const nb = Number(b.slice(db + 1));
	if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
	return a < b ? -1 : a > b ? 1 : 0;
}

function parseTime(value: string | null, fallback: number): number {
	const time = value ? Date.parse(value) : NaN;
	return Number.isFinite(time) ? time : fallback;
}

export function phaseOf(row: MapItemRow): MapPhase {
	switch (row.status) {
		case 'done':
			return 'done';
		case 'in_progress':
		case 'in_review':
			return 'in_flight';
		case 'blocked':
			return row.startedAt ? 'in_flight' : 'later';
		case 'ready':
			return row.blocked ? 'later' : 'next';
	}
}

function radiusOf(item: ModelItem): number {
	if (item.hub) return 0;
	const inFlight = item.phase === 'in_flight';
	if (!item.children.length) return inFlight ? IN_FLIGHT_RADIUS : LEAF_RADIUS;
	const base = PARENT_RADIUS_BASE + PARENT_RADIUS_GROWTH * Math.sqrt(item.descendants);
	return inFlight ? base * IN_FLIGHT_PARENT_SCALE : base;
}

/** The board's own order: rank, then filed first, then key. */
function byRank(a: ModelItem, b: ModelItem): number {
	return a.row.rank - b.row.rank || parseTime(a.row.createdAt, 0) - parseTime(b.row.createdAt, 0) || a.index - b.index;
}

export function buildModel(rows: readonly MapItemRow[], now: number, collapse: Readonly<Record<string, boolean>>): MapModel {
	const sorted = [...rows].sort((a, b) => compareKeys(a.key, b.key));
	const items: ModelItem[] = sorted.map((row, index) => {
		const created = parseTime(row.createdAt, now);
		const own = parseTime(row.timeAnchor, created);
		// Every item represents itself until collapse says otherwise.
		const item = {
			row,
			key: row.key,
			index,
			parent: null,
			children: [],
			phase: phaseOf(row),
			descendants: 0,
			anchor: own,
			completion: own,
			collapsed: false,
			hub: false,
			family: null,
			radius: 0,
		} as Omit<ModelItem, 'rep'> as ModelItem;
		item.rep = item;
		return item;
	});
	const byKey = new Map(items.map((item) => [item.key, item]));
	const newest = items.reduce((max, item) => Math.max(max, item.anchor), -Infinity);

	for (const item of items) {
		const parent = item.row.parentKey ? byKey.get(item.row.parentKey) : undefined;
		if (!parent) continue;
		// A parent link that would close a loop is dropped rather than followed forever.
		let cursor: ModelItem | null = parent;
		while (cursor && cursor !== item) cursor = cursor.parent;
		if (!cursor) item.parent = parent;
	}
	for (const item of items) item.parent?.children.push(item);
	for (const item of items) item.children.sort(byRank);

	// Parents before children, so top-down passes see a settled parent and bottom-up
	// passes (reversed) see settled children.
	const depth = new Map<ModelItem, number>();
	const depthOf = (item: ModelItem): number => {
		let d = depth.get(item);
		if (d === undefined) {
			d = item.parent ? depthOf(item.parent) + 1 : 0;
			depth.set(item, d);
		}
		return d;
	};
	const topDown = [...items].sort((a, b) => depthOf(a) - depthOf(b) || a.index - b.index);

	const allDone = new Map<ModelItem, boolean>();
	for (let i = topDown.length - 1; i >= 0; i--) {
		const item = topDown[i]!;
		let done = item.phase === 'done';
		for (const child of item.children) {
			item.anchor = Math.max(item.anchor, child.anchor);
			item.descendants += child.descendants + 1;
			done &&= allDone.get(child)!;
		}
		allDone.set(item, done);
		if (item.phase === 'done') item.completion = parseTime(item.row.completedAt, item.anchor);
	}

	for (const item of topDown) {
		item.collapsed = item.children.length > 0 && (collapse[item.key] ?? allDone.get(item)!);
		const parent = item.parent;
		if (parent) item.rep = parent.rep !== parent ? parent.rep : parent.collapsed ? parent : item;
		item.hub = item.rep === item && item.children.length > 0 && !item.collapsed;
		if (item.rep === item && parent) {
			let root = parent;
			while (root.parent) root = root.parent;
			item.family = root.key;
		}
		item.radius = radiusOf(item);
	}

	const edges = blockerEdges(items, byKey);
	const { chains, chainBlocked, relatedChains } = chainsOf(items, edges);
	const plan = planOf(items);
	const { sessions, computers } = sessionsOf(items, now);

	return {
		items,
		byKey,
		edges,
		chains,
		chainBlocked,
		relatedChains,
		upNext: plan.upNext,
		planOrder: plan.planOrder,
		deadlocked: deadlockedOf(items, edges),
		sessions,
		computers,
		newest,
		times: items.map((item) => item.anchor).sort((a, b) => a - b),
	};
}

/** Every link that counts, open or satisfied, once per pair, with cycles marked. */
function blockerEdges(items: readonly ModelItem[], byKey: ReadonlyMap<string, ModelItem>): BlockerEdge[] {
	const edges: BlockerEdge[] = [];
	for (const blocked of items) {
		const seen = new Map<ModelItem, BlockerEdge>();
		for (const link of blocked.row.blockers) {
			if (link.state === 'removed') continue;
			const blocker = byKey.get(link.blockerKey);
			if (!blocker || blocker === blocked) continue;
			const satisfied = link.state === 'satisfied';
			const prior = seen.get(blocker);
			if (prior) {
				prior.satisfied &&= satisfied;
				continue;
			}
			const edge = { blocker, blocked, satisfied, cyclic: false };
			seen.set(blocker, edge);
			edges.push(edge);
		}
	}
	edges.sort((a, b) => a.blocked.index - b.blocked.index || a.blocker.index - b.blocker.index);
	const { component, size } = stronglyConnected(
		items.length,
		edges.map((e): Edge => [e.blocker.index, e.blocked.index]),
	);
	for (const edge of edges) {
		const c = component[edge.blocker.index]!;
		edge.cyclic = c === component[edge.blocked.index] && size[c]! > 1;
	}
	return edges;
}

/** Items in a cycle of open blockers: a deadlock that needs a person. */
function deadlockedOf(items: readonly ModelItem[], edges: readonly BlockerEdge[]): string[] {
	const open = edges.filter((e) => !e.satisfied).map((e): Edge => [e.blocker.index, e.blocked.index]);
	const { component, size } = stronglyConnected(items.length, open);
	return items.filter((item) => size[component[item.index]!]! > 1).map((item) => item.key);
}

function chainsOf(
	items: readonly ModelItem[],
	edges: readonly BlockerEdge[],
): Pick<MapModel, 'chains' | 'chainBlocked' | 'relatedChains'> {
	const chainEdges = edges.filter((e) => !e.cyclic && e.blocked.parent?.hub && e.blocked.parent === e.blocker.parent);

	const root = new Map<ModelItem, ModelItem>();
	const find = (item: ModelItem): ModelItem => {
		let r = item;
		while (root.get(r) !== r) r = root.get(r)!;
		root.set(item, r);
		return r;
	};
	for (const e of chainEdges) {
		for (const item of [e.blocker, e.blocked]) if (!root.has(item)) root.set(item, item);
		const a = find(e.blocker);
		const b = find(e.blocked);
		if (a !== b) {
			if (a.index < b.index) root.set(b, a);
			else root.set(a, b);
		}
	}

	const groupOf = new Map<ModelItem, number>();
	const roots = [...root.keys()].map(find).filter((r, i, all) => all.indexOf(r) === i).sort((a, b) => a.index - b.index);
	const chains: ChainGroup[] = roots.map((r) => ({ parent: r.parent!, items: [], edges: [] }));
	const rootIndex = new Map(roots.map((r, i) => [r, i]));
	for (const item of root.keys()) groupOf.set(item, rootIndex.get(find(item))!);
	for (const e of chainEdges) chains[groupOf.get(e.blocked)!]!.edges.push(e);
	for (const chain of chains) {
		const members = [...new Set(chain.edges.flatMap((e) => [e.blocker, e.blocked]))].sort((a, b) => a.index - b.index);
		const local = new Map(members.map((m, i) => [m, i]));
		const order = topologicalOrder(
			members.length,
			chain.edges.map((e): Edge => [local.get(e.blocker)!, local.get(e.blocked)!]),
		);
		chain.items = order.map((i) => members[i]!);
	}

	const pairs = new Set<string>();
	const relate = (a: ModelItem, b: ModelItem): void => {
		const ga = groupOf.get(a);
		const gb = groupOf.get(b);
		if (ga === undefined || gb === undefined || ga === gb) return;
		pairs.add(ga < gb ? `${ga}:${gb}` : `${gb}:${ga}`);
	};
	for (let i = 0; i < chains.length; i++) {
		for (let j = i + 1; j < chains.length; j++) if (chains[i]!.parent === chains[j]!.parent) pairs.add(`${i}:${j}`);
	}
	for (const item of groupOf.keys()) {
		if (item.parent) relate(item, item.parent);
		for (const child of item.children) relate(item, child);
	}
	const byKey = new Map(items.map((item) => [item.key, item]));
	for (const item of items) {
		const from = item.row.discoveredFromKey ? byKey.get(item.row.discoveredFromKey) : undefined;
		if (from) relate(item, from);
	}
	for (const e of edges) relate(e.blocker, e.blocked);
	const relatedChains = [...pairs]
		.map((pair): [number, number] => {
			const [a, b] = pair.split(':').map(Number);
			return [a!, b!];
		})
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	return { chains, chainBlocked: new Set(chainEdges.map((e) => e.blocked)), relatedChains };
}

/**
 * Up next is `/specboard:whats-next`'s order: the next ready child of each in-flight
 * parent, then the top of the project-wide ready list (top-level, unblocked, by rank,
 * which is what MCP `get_items status=ready` returns). The plan order puts all of
 * that first, then every other next or later item by rank, parent before children.
 */
function planOf(items: readonly ModelItem[]): { upNext: string[]; planOrder: string[] } {
	const walk: ModelItem[] = [];
	const visit = (item: ModelItem): void => {
		walk.push(item);
		for (const child of item.children) visit(child);
	};
	const topLevel = items.filter((item) => !item.parent).sort(byRank);
	for (const item of topLevel) visit(item);

	const ups: ModelItem[] = [];
	const add = (item: ModelItem | undefined): void => {
		if (item && !ups.includes(item)) ups.push(item);
	};
	for (const parent of walk) {
		if (parent.children.length && parent.phase === 'in_flight') add(parent.children.find((c) => c.phase === 'next'));
	}
	for (const item of topLevel) if (item.phase === 'next') add(item);

	const planOrder = ups.map((item) => item.key);
	const planned = new Set(ups);
	for (const item of walk) {
		if (!planned.has(item) && (item.phase === 'next' || item.phase === 'later')) planOrder.push(item.key);
	}
	return { upNext: ups.slice(0, UP_NEXT_COUNT).map((item) => item.key), planOrder };
}

/**
 * Sessions that wrote in the last hour on in-flight work, grouped by computer. Sessions
 * are numbered within their computer in session-key order: stable while the set of
 * sessions is, with nothing better to go on since episodes carry no start here.
 */
function sessionsOf(items: readonly ModelItem[], now: number): { sessions: SessionModel[]; computers: ComputerModel[] } {
	const byKey = new Map<string, SessionModel>();
	for (const item of items) {
		if (item.phase !== 'in_flight') continue;
		for (const episode of item.row.workers) {
			const lastWriteAt = parseTime(episode.lastWriteAt, -Infinity);
			if (now - lastWriteAt > SESSION_LIVE) continue;
			let session = byKey.get(episode.sessionKey);
			if (!session) {
				session = {
					key: episode.sessionKey,
					device: episode.deviceName ?? '',
					client: episode.client,
					lastWriteAt,
					number: 0,
					items: [],
				};
				byKey.set(session.key, session);
			}
			session.lastWriteAt = Math.max(session.lastWriteAt, lastWriteAt);
			if (!session.items.includes(item)) session.items.push(item);
		}
	}
	const sessions = [...byKey.values()].sort((a, b) =>
		a.device < b.device ? -1 : a.device > b.device ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
	);
	const computers: ComputerModel[] = [];
	for (const session of sessions) {
		let computer = computers[computers.length - 1];
		if (!computer || computer.device !== session.device) {
			computer = { device: session.device, sessions: [] };
			computers.push(computer);
		}
		computer.sessions.push(session);
		session.number = computer.sessions.length;
	}
	return { sessions, computers };
}
