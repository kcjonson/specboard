import type { Force } from 'd3-force';
import { REGION_BAND_GAP, REGION_BAND_STRENGTH } from './constants';
import type { SimLink, SimNode } from './forces';

export interface Band {
	/** Its unseen center, and the centers of any regions nested in it. */
	hubs: SimNode[];
	/** Every dot drawn inside the region, nested regions' dots included. */
	members: SimNode[];
	/** The enclosing region's index in the same list, -1 at the top level. */
	parent: number;
}

/**
 * Regions don't overlap. A family is a row across time (see familyRows), so sibling
 * regions whose stretches of time overlap have to sit at different heights, or one
 * family's dots land between the other's and cut its outline in two. Pairwise dot
 * separation can't stop that: a long-running family's dots are far apart along its
 * row, with room for a stranger between any two. So each tick, every pair of siblings
 * that share time and sit closer than their half-heights plus a gap is pushed apart,
 * each region moving as one, nested regions with it.
 */
export function regionBands(bands: readonly Band[]): Force<SimNode, SimLink> {
	const count = bands.length;
	const minX = new Float64Array(count);
	const maxX = new Float64Array(count);
	const centerY = new Float64Array(count);
	const half = new Float64Array(count);
	const push = new Float64Array(count);
	const groups = new Map<number, number[]>();
	bands.forEach((band, i) => {
		const group = groups.get(band.parent);
		if (group) group.push(i);
		else groups.set(band.parent, [i]);
	});
	const siblings = [...groups.values()].filter((group) => group.length > 1);

	return (alpha: number): void => {
		if (!siblings.length) return;
		for (let i = 0; i < count; i++) {
			const { members } = bands[i]!;
			let lo = Infinity;
			let hi = -Infinity;
			let sumY = 0;
			for (const n of members) {
				lo = Math.min(lo, n.x - n.r);
				hi = Math.max(hi, n.x + n.r);
				sumY += n.y;
			}
			const cy = sumY / members.length;
			let extent = 0;
			for (const n of members) extent = Math.max(extent, Math.abs(n.y - cy) + n.r);
			minX[i] = lo;
			maxX[i] = hi;
			centerY[i] = cy;
			half[i] = extent;
			push[i] = 0;
		}
		for (const group of siblings) {
			for (let p = 0; p < group.length; p++) {
				const a = group[p]!;
				for (let q = p + 1; q < group.length; q++) {
					const b = group[q]!;
					if (maxX[a]! + REGION_BAND_GAP < minX[b]! || maxX[b]! + REGION_BAND_GAP < minX[a]!) continue;
					const want = half[a]! + half[b]! + REGION_BAND_GAP;
					const dy = centerY[b]! - centerY[a]!;
					if (Math.abs(dy) >= want) continue;
					// Level regions part in list order, which is key order, so it's deterministic.
					const f = ((dy >= 0 ? 1 : -1) * want - dy) * alpha * REGION_BAND_STRENGTH;
					push[a]! -= f / 2;
					push[b]! += f / 2;
				}
			}
		}
		// Members include nested regions' dots, so a nested region moves with each region around it.
		for (let i = 0; i < count; i++) {
			const shift = push[i]!;
			if (shift === 0) continue;
			for (const n of bands[i]!.hubs) n.vy += shift;
			for (const n of bands[i]!.members) n.vy += shift;
		}
	};
}
