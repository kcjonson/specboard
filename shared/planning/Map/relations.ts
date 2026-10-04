import type { MapItemRow } from '@specboard/core/map-read';
import type { MapLayout, MapRegion } from './layout/types';

/**
 * What lights when an item or a region is hovered, focused, or selected (spec,
 * Relationships and What shows when): its region, its whole blocker chain both ways
 * (satisfied links included), transitively, and its discovered-from lineage both ways.
 * Everything else fades. Sets are keyed by the node that draws an item, so a family
 * folded into a dot is the dot.
 */
export interface Relation {
	/** The node that draws the item the person is on. */
	key: string;
	/** The item is drawn as a region, so it is its family that lights. */
	region: boolean;
	/** Dots drawn at full strength: the target, its region's members, and the chain and lineage. */
	dots: ReadonlySet<string>;
	/** Regions drawn at full strength: the target's own with the ones around and inside it, and any region a related item stands for. */
	regions: ReadonlySet<string>;
	/** The one region whose outline darkens, if any. */
	outline: string | null;
	/** Link ids that show and draw lit, whether or not All links is on. */
	links: ReadonlySet<string>;
}

/** Both link kinds a blocker pair can draw as: a chain's hairline inside a family, or an arc between families. */
const blockerIds = (blocker: string, blocked: string): string[] => [`blocker:${blocker}>${blocked}`, `chain:${blocker}>${blocked}`];

/**
 * The graph every relation is read from, built once per layout and its rows. Asking
 * for one item's relation then costs the size of that item's neighborhood.
 */
export class RelationIndex {
	private readonly representative: Readonly<Record<string, string>>;
	private readonly waitsOn = new Map<string, string[]>();
	private readonly blocks = new Map<string, string[]>();
	private readonly sourceOf = new Map<string, string[]>();
	private readonly spawned = new Map<string, string[]>();
	private readonly regions = new Map<string, MapRegion>();
	/** Each dot's innermost region. */
	private readonly regionOf = new Map<string, MapRegion>();
	private readonly cache = new Map<string, Relation | null>();

	constructor(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>) {
		this.representative = layout.representative;
		const push = (map: Map<string, string[]>, key: string, value: string): void => {
			const list = map.get(key);
			if (list) list.push(value);
			else map.set(key, [value]);
		};
		for (const row of rows.values()) {
			for (const link of row.blockers) {
				if (!rows.has(link.blockerKey)) continue;
				push(this.waitsOn, row.key, link.blockerKey);
				push(this.blocks, link.blockerKey, row.key);
			}
			if (row.discoveredFromKey && rows.has(row.discoveredFromKey)) {
				push(this.sourceOf, row.key, row.discoveredFromKey);
				push(this.spawned, row.discoveredFromKey, row.key);
			}
		}
		for (const region of layout.regions) this.regions.set(region.key, region);
		for (const region of layout.regions) {
			for (const member of region.members) {
				const current = this.regionOf.get(member);
				if (!current || region.depth > current.depth) this.regionOf.set(member, region);
			}
		}
	}

	/** Whether the item is drawn as a region rather than a dot. */
	isRegion(key: string): boolean {
		return this.regions.has(this.representative[key] ?? key);
	}

	/** The relation of an item's drawn node, or null when the Map doesn't draw the item. */
	relation(key: string): Relation | null {
		const cached = this.cache.get(key);
		if (cached !== undefined) return cached;
		const relation = this.compute(key);
		this.cache.set(key, relation);
		return relation;
	}

	private compute(key: string): Relation | null {
		const node = this.representative[key];
		if (!node) return null;
		const region = this.regions.get(node);
		return region ? this.regionRelation(region) : this.itemRelation(key, node);
	}

	private regionRelation(region: MapRegion): Relation {
		const regions = new Set<string>([region.key]);
		for (const other of this.regions.values()) {
			if (this.within(other, region.key)) regions.add(other.key);
		}
		for (let up = region.parentKey ? this.regions.get(region.parentKey) : undefined; up; up = up.parentKey ? this.regions.get(up.parentKey) : undefined) {
			regions.add(up.key);
		}
		return { key: region.key, region: true, dots: new Set(region.members), regions, outline: region.key, links: new Set() };
	}

	private itemRelation(key: string, node: string): Relation {
		const dots = new Set<string>([node]);
		const regions = new Set<string>();
		const links = new Set<string>();
		const inner = this.regionOf.get(node) ?? null;
		if (inner) {
			for (const member of inner.members) dots.add(member);
			regions.add(inner.key);
			for (let up = inner.parentKey ? this.regions.get(inner.parentKey) : undefined; up; up = up.parentKey ? this.regions.get(up.parentKey) : undefined) {
				regions.add(up.key);
			}
		}
		const take = (item: string): void => {
			const drawn = this.representative[item];
			if (!drawn) return;
			if (this.regions.has(drawn)) regions.add(drawn);
			else dots.add(drawn);
		};
		// What it waits on, transitively, and what waits on it: two directions, never the whole connected graph.
		const addBlocker = (blocker: string, blocked: string): void => {
			for (const id of blockerIds(blocker, blocked)) links.add(id);
		};
		this.walk(this.waitsOn, key, take, (near, far) => addBlocker(far, near));
		this.walk(this.blocks, key, take, (near, far) => addBlocker(near, far));
		this.walk(this.sourceOf, key, take, (near, far) => links.add(`discovered:${far}>${near}`));
		this.walk(this.spawned, key, take, (near, far) => links.add(`discovered:${near}>${far}`));
		return { key: node, region: false, dots, regions, outline: inner?.key ?? null, links };
	}

	/** Visits everything reachable from `start` along `edges`, once each, naming every edge as (the nearer end, the farther one). */
	private walk(
		edges: ReadonlyMap<string, string[]>,
		start: string,
		visit: (key: string) => void,
		edge: (near: string, far: string) => void,
	): void {
		const seen = new Set<string>([start]);
		const queue = [start];
		for (let at = 0; at < queue.length; at++) {
			const near = queue[at]!;
			for (const far of edges.get(near) ?? []) {
				edge(near, far);
				if (seen.has(far)) continue;
				seen.add(far);
				visit(far);
				queue.push(far);
			}
		}
	}

	/** Whether `region` is `ancestor` or nested somewhere inside it. */
	private within(region: MapRegion, ancestor: string): boolean {
		for (let at: MapRegion | undefined = region; at; at = at.parentKey ? this.regions.get(at.parentKey) : undefined) {
			if (at.key === ancestor) return true;
		}
		return false;
	}
}
