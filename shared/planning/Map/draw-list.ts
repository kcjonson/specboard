import type { MapItemRow, MapItemStatus } from '@specboard/core/map-read';
import { glyphStatus } from '@specboard/ui';
import { agentsOf, type Agents } from './agents';
import type { Dot } from './camera';
import type { MapLayout, MapNode, MapPhase, MapPoint } from './layout/types';
import type { LinkKind } from './links';
import { REASON_ORDER, needsPerson, type NeedsPersonReasons, type NeedsReason } from './needs-person';
import { planWeights, weightedRadius } from './plan-weight';

/** A subtree's items by phase, the parent itself not counted. */
export type Rollup = Record<MapPhase, number>;

/** The sub-status cues a glyph carries beyond its status; needs input and PR open are the ink ring and the PR mark. */
export type GlyphCue = 'scoping' | 'paused';

/** A collapsed parent's dot: its family folded in. */
export interface FoldedFamily {
	/** The parent and everything under it. */
	count: number;
	rollup: Rollup;
	/** False for a finished family the read summarized past its cap: its children never arrived, so there is nothing to open. */
	expandable: boolean;
}

/** One glyph for the renderer, in layout units. The renderer knows nothing of rows, layouts, or the model. */
export interface DrawDot extends Dot {
	title: string;
	status: MapItemStatus;
	/** The board status when the item is in flight, whatever the glyph shows: a blocked in-progress item still sorts as in progress. */
	flight: 'in_progress' | 'in_review' | null;
	/** Plan weight, 1 at full strength (see plan-weight.ts). `r` already carries it. */
	weight: number;
	/** Why the item needs a person, most pressing first: it wears the ink ring, and zoomed in the lead reason's tag. A folded family carries what is inside it. */
	reason: NeedsReason | null;
	/** 1 to 3 on an item up next, in the order the agents pick them up. */
	upNext: number | null;
	cue: GlyphCue | null;
	/** The item has a PR (pr_url set, or sub-status PR open). */
	pr: boolean;
	/** A live session is on it: the still amber glow behind the dot. */
	live: boolean;
	/** Set on a collapsed parent's dot. */
	folded: FoldedFamily | null;
}

/**
 * A computer or a session, drawn at its layout node. A session is a numbered dot; a
 * quiet one (no write for 15 minutes) is hollow and dim, and a computer is live while
 * any of its sessions is.
 */
export interface DrawAgent extends Dot {
	/** The layout node's key, `session:<key>` or `computer:<device>`. */
	kind: 'session' | 'computer';
	/** The session's number within its computer; 0 for a computer. */
	number: number;
	state: 'live' | 'quiet';
}

/** What a region's label carries: the parent's status, title, and the rollup bar. */
export interface DrawRegion {
	key: string;
	title: string;
	status: MapItemStatus;
	/** The parent's plan weight, cue, and PR mark, which its label glyph carries as a dot would. */
	weight: number;
	cue: GlyphCue | null;
	pr: boolean;
	reason: NeedsReason | null;
	upNext: number | null;
	rollup: Rollup;
	/** Dots inside, nested regions' included; bigger regions get their labels first. */
	size: number;
}

export interface DrawLink {
	/** `<kind>:<from item>><to item>`, by item key, so focus can name the links it lights. */
	id: string;
	kind: LinkKind;
	/** The nodes that draw its two items, so focus can tell a link inside the related set from one that leaves it. */
	ends: readonly [string, string];
	from: MapPoint;
	to: MapPoint;
	/** A blocker the work cleared: it keeps drawing, lighter. */
	satisfied: boolean;
	/** An agent line from a live session; a quiet one draws dim. */
	live: boolean;
}

export interface DrawList {
	dots: DrawDot[];
	regions: DrawRegion[];
	links: DrawLink[];
	/** Computers and sessions still in the cluster, past now. */
	agents: DrawAgent[];
	/** What the agents are, for their text blocks, cards, and roster. */
	working: Agents;
	/** Every item that needs a person and why, by item key: what the quick card leads with. */
	needs: NeedsPersonReasons;
}

/** In flight work draws on top of what it overlaps. */
const LAYER: Record<MapItemStatus, number> = { done: 0, blocked: 1, ready: 1, in_review: 2, in_progress: 2 };

const emptyRollup = (): Rollup => ({ done: 0, in_flight: 0, next: 0, later: 0 });

const cueOf = (row: MapItemRow): GlyphCue | null =>
	row.status === 'done' ? null : row.subStatus === 'scoping' ? 'scoping' : row.subStatus === 'paused' ? 'paused' : null;

const prOf = (row: MapItemRow): boolean => row.prUrl !== null || row.subStatus === 'pr_open';

/**
 * Everything the far and middle zoom levels draw from a settled layout: a glyph per
 * dot, a label per region (the outline itself comes from the region outlines), and
 * every link, which the frame's lighting decides whether to show. A parent with
 * visible children (a hub) is a region and draws no dot. Computers and sessions are the
 * ones still in the cluster at `now`; the layout is as of when it ran, and time passes.
 */
export function buildDrawList(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, now: number): DrawList {
	const weights = planWeights(layout.planOrder);
	const working = agentsOf(layout, rows, now);
	const live = new Set(working.sessions.filter((session) => session.state === 'live').flatMap((session) => session.items.map((item) => item.drawnBy)));
	const needs = needsPerson(rows.values(), layout, now);
	const reasons = reasonsByNode(layout, needs);
	// An up-next item folded into a collapsed family is marked on the family's dot, with the lowest number inside it.
	const upNext = new Map<string, number>();
	layout.upNext.forEach((key, i) => {
		const node = layout.representative[key];
		if (node && !upNext.has(node)) upNext.set(node, i + 1);
	});
	const rollups = subtreeRollups(rows, layout.phases);
	const rollupOf = (key: string): Rollup => rollups.get(key) ?? emptyRollup();
	const collapsed = new Set(layout.collapsed);

	const dots: DrawDot[] = [];
	for (const node of layout.nodes) {
		if (node.kind !== 'item' || node.hub) continue;
		const row = rows.get(node.key);
		if (!row) continue;
		const weight = weights.get(node.key) ?? 1;
		let folded: FoldedFamily | null = null;
		const expandable = collapsed.has(node.key);
		if (expandable || row.summarizedDescendants) {
			const rollup = rollupOf(node.key);
			folded = { count: 1 + rollup.done + rollup.in_flight + rollup.next + rollup.later, rollup, expandable };
		}
		dots.push({
			key: node.key,
			x: node.x,
			y: node.y,
			r: weightedRadius(node.r, weight),
			title: row.title,
			status: glyphStatus(row.status, row.blocked),
			flight: row.status === 'in_progress' || row.status === 'in_review' ? row.status : null,
			weight,
			reason: reasons.get(node.key) ?? null,
			upNext: upNext.get(node.key) ?? null,
			cue: cueOf(row),
			pr: prOf(row),
			live: live.has(node.key),
			folded,
		});
	}
	dots.sort((a, b) => LAYER[a.status] - LAYER[b.status]);

	const regions: DrawRegion[] = [];
	for (const region of layout.regions) {
		const row = rows.get(region.key);
		if (!row) continue;
		regions.push({
			key: region.key,
			title: row.title,
			status: glyphStatus(row.status, row.blocked),
			weight: weights.get(region.key) ?? 1,
			cue: cueOf(row),
			pr: prOf(row),
			reason: reasons.get(region.key) ?? null,
			upNext: upNext.get(region.key) ?? null,
			rollup: rollupOf(region.key),
			size: region.members.length,
		});
	}

	const placed = new Map(layout.nodes.map((node) => [node.key, node]));
	const agents: DrawAgent[] = [];
	for (const computer of working.computers) {
		const node = placed.get(computer.node);
		if (node) agents.push({ key: node.key, kind: 'computer', x: node.x, y: node.y, r: node.r, number: 0, state: computer.live ? 'live' : 'quiet' });
	}
	for (const session of working.sessions) {
		const node = placed.get(session.node);
		if (node) agents.push({ key: node.key, kind: 'session', x: node.x, y: node.y, r: node.r, number: session.number, state: session.state });
	}

	return { dots, regions, links: [...linksOf(layout, rows), ...agentLinks(working, placed)], agents, working, needs };
}

/** Each computer's tie to its sessions, and each session's amber line to every item it is on. */
function agentLinks(working: Agents, placed: ReadonlyMap<string, MapNode>): DrawLink[] {
	const links: DrawLink[] = [];
	const add = (kind: 'machine' | 'agent', fromKey: string, toKey: string, live: boolean): void => {
		const from = placed.get(fromKey);
		const to = placed.get(toKey);
		if (!from || !to) return;
		links.push({ id: `${kind}:${fromKey}>${toKey}`, kind, ends: [fromKey, toKey], from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, satisfied: false, live });
	};
	for (const session of working.sessions) {
		add('machine', session.computer, session.node, session.state === 'live');
		for (const item of session.items) add('agent', session.node, item.drawnBy, session.state === 'live');
	}
	return links;
}

/**
 * The lead reason each drawn node wears. An item inside a folded family is drawn by the
 * family's dot, so the dot carries what is hidden in it: a collapsed epic with a question
 * somewhere under it still shows the ring.
 */
function reasonsByNode(layout: MapLayout, needs: NeedsPersonReasons): Map<string, NeedsReason> {
	const lead = new Map<string, NeedsReason>();
	for (const [key, reasons] of needs) {
		const node = layout.representative[key];
		if (!node) continue;
		const best = lead.get(node);
		const mine = reasons[0]!;
		if (!best || REASON_ORDER.indexOf(mine) < REASON_ORDER.indexOf(best)) lead.set(node, mine);
	}
	return lead;
}

/**
 * Every row's subtree by phase, in one pass: a breadth-first walk down from the roots
 * gives each row its place, then the walk in reverse folds each subtree into its
 * parent's. No recursion, since nesting has no depth limit, and each row is reached
 * once, so a parent loop in bad data (which the layout drops too) can't spin. Past
 * the read cap a finished family comes back as one row carrying its count; those
 * descendants are all done.
 */
export function subtreeRollups(rows: ReadonlyMap<string, MapItemRow>, phases: Readonly<Record<string, MapPhase>>): Map<string, Rollup> {
	const children = new Map<string, MapItemRow[]>();
	const roots: MapItemRow[] = [];
	for (const row of rows.values()) {
		if (!row.parentKey || !rows.has(row.parentKey)) {
			roots.push(row);
			continue;
		}
		const siblings = children.get(row.parentKey) ?? [];
		siblings.push(row);
		children.set(row.parentKey, siblings);
	}
	const order: MapItemRow[] = [];
	const parentOf = new Map<string, string>();
	const reached = new Set<string>();
	const walk = (start: MapItemRow): void => {
		if (reached.has(start.key)) return;
		reached.add(start.key);
		const queue = [start];
		for (let at = 0; at < queue.length; at++) {
			const row = queue[at]!;
			order.push(row);
			for (const child of children.get(row.key) ?? []) {
				if (reached.has(child.key)) continue;
				reached.add(child.key);
				parentOf.set(child.key, row.key);
				queue.push(child);
			}
		}
	};
	for (const root of roots) walk(root);
	// Rows on a parent loop have no root above them.
	for (const row of rows.values()) walk(row);

	const rollups = new Map<string, Rollup>();
	for (const row of order) {
		const rollup = emptyRollup();
		rollup.done += row.summarizedDescendants ?? 0;
		rollups.set(row.key, rollup);
	}
	for (let i = order.length - 1; i >= 0; i--) {
		const row = order[i]!;
		const parent = parentOf.get(row.key);
		if (parent === undefined) continue;
		const into = rollups.get(parent)!;
		const own = rollups.get(row.key)!;
		into[phases[row.key]!]++;
		into.done += own.done;
		into.in_flight += own.in_flight;
		into.next += own.next;
		into.later += own.later;
	}
	return rollups;
}

/** Chain links, the other blocker links, and discovered-from, each between the nodes that draw its two items. */
function linksOf(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>): DrawLink[] {
	const nodes = new Map<string, MapNode>();
	for (const node of layout.nodes) if (node.kind === 'item') nodes.set(node.key, node);
	const links: DrawLink[] = [];
	const add = (kind: LinkKind, fromKey: string, toKey: string, satisfied: boolean): void => {
		if (!rows.has(fromKey) || !rows.has(toKey)) return;
		const from = nodes.get(layout.representative[fromKey] ?? '');
		const to = nodes.get(layout.representative[toKey] ?? '');
		if (!from || !to || from === to) return;
		links.push({ id: `${kind}:${fromKey}>${toKey}`, kind, ends: [from.key, to.key], from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, satisfied, live: false });
	};

	const inChains = new Set<string>();
	for (const chain of layout.chains) {
		for (const link of chain.links) {
			inChains.add(`${link.blocker}>${link.blocked}`);
			add('chain', link.blocker, link.blocked, link.satisfied);
		}
	}
	for (const row of rows.values()) {
		for (const link of row.blockers) {
			if (inChains.has(`${link.blockerKey}>${row.key}`)) continue;
			add('blocker', link.blockerKey, row.key, link.state === 'satisfied');
		}
		if (row.discoveredFromKey) add('discovered', row.discoveredFromKey, row.key, false);
	}
	return links;
}

/**
 * What time can change in a draw list without a new layout: which sessions are live or
 * quiet or gone, and which items need a person. Two lists with the same key draw alike,
 * so a clock tick that moves nothing costs no repaint.
 */
export function presenceKey(list: DrawList): string {
	const agents = list.agents.map((agent) => `${agent.key}=${agent.state}`).join(',');
	const needing = [...list.needs].map(([key, reasons]) => `${key}=${reasons.join('+')}`).join(',');
	return `${agents}|${needing}`;
}
