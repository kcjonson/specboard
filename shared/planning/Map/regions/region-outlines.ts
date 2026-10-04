import type { MapLayout } from '../layout/types';
import { traceRegions, type RegionInput, type RegionOutline } from './outline';

/** The outline is resolved to this many screen pixels. */
const GRID_PX = 5;

/**
 * Grid steps in layout units. Zooms are bucketed by powers of two, so a pan never
 * recomputes and a zoom recomputes at most once per bucket. Closer in than 2x, cells
 * stay 2.5 units, which the smoothing keeps round at the far and middle levels. Further
 * out than 1x they stay 5: a coarser grid can't resolve a family's neck (its corridor
 * is about 10 units across), so a long-running epic would break into islands and lose
 * members, and step 5 already costs little next to the layout.
 */
const MIN_STEP = 2.5;
const MAX_STEP = 5;

/** The grid step for outlines drawn at scale `k`. */
export function gridStep(k: number): number {
	const level = 2 ** Math.round(Math.log2(Math.max(k, 1e-6)));
	return Math.max(MIN_STEP, Math.min(MAX_STEP, GRID_PX / level));
}

/** What the outline math needs of a layout: each region's members where the layout put them, and how deep its nesting runs. */
export function regionInputs(layout: MapLayout): RegionInput[] {
	const nodes = new Map(layout.nodes.map((node) => [node.key, node]));
	// Deepest first, so a region's children all have their heights before it does. No
	// recursion: nesting has no depth limit.
	const heights = new Map<string, number>();
	for (const region of [...layout.regions].sort((a, b) => b.depth - a.depth)) {
		const height = heights.get(region.key) ?? 1;
		heights.set(region.key, height);
		if (region.parentKey) heights.set(region.parentKey, Math.max(heights.get(region.parentKey) ?? 1, height + 1));
	}
	return layout.regions.map((region) => ({
		key: region.key,
		parentKey: region.parentKey,
		height: heights.get(region.key)!,
		members: region.members.flatMap((key) => {
			const node = nodes.get(key);
			return node ? [{ x: node.x, y: node.y, r: node.r }] : [];
		}),
	}));
}

/**
 * One layout's outlines, computed once per grid step and kept. Outlines are in layout
 * units, so any step's outlines draw correctly at any zoom; a finer step only resolves
 * them better. That lets a zoom draw what's cached while the step it wants is computed
 * off the gesture's critical path.
 */
export class RegionOutlines {
	private readonly inputs: RegionInput[];
	private readonly cache = new Map<number, RegionOutline[]>();
	/** Milliseconds each step took, for measuring. */
	readonly timings = new Map<number, number>();
	private readonly clock: () => number;

	constructor(layout: MapLayout, clock: () => number = () => globalThis.performance.now()) {
		this.inputs = regionInputs(layout);
		this.clock = clock;
	}

	get empty(): boolean {
		return this.inputs.length === 0;
	}

	has(step: number): boolean {
		return this.cache.has(step);
	}

	/** The outlines at `step`, computing them if this step hasn't been asked for before. */
	at(step: number): RegionOutline[] {
		let outlines = this.cache.get(step);
		if (!outlines) {
			const start = this.clock();
			outlines = traceRegions(this.inputs, step);
			this.timings.set(step, this.clock() - start);
			this.cache.set(step, outlines);
		}
		return outlines;
	}

	/** The cached outlines nearest `step`, or undefined before any have been computed. */
	nearest(step: number): RegionOutline[] | undefined {
		let best: number | undefined;
		for (const cached of this.cache.keys()) {
			if (best === undefined || Math.abs(Math.log2(cached / step)) < Math.abs(Math.log2(best / step))) best = cached;
		}
		return best === undefined ? undefined : this.cache.get(best);
	}
}
