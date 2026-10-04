import type { Force } from 'd3-force';
import { REGION_BAND_GAP, REGION_BAND_STRENGTH } from './constants';
import type { SimLink, SimNode } from './forces';

export interface Band {
	/** The region's unseen center; none for the band of a parent's own direct children. */
	hub: SimNode | null;
	/** Dots directly in this band. Nested regions' dots belong to their own bands. */
	direct: SimNode[];
	/** The enclosing band's index in the same list, -1 at the top level. */
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
 *
 * Extents gather bottom-up from each band's direct dots and its nested bands, and
 * shifts hand down top-down, so a tick is linear in dots however deep the nesting.
 *
 * A region with any dot pinned (a local pass holds everything it didn't reach) isn't
 * pushed: it can only move as a whole, and a push that moved only its free part would
 * bend it. Its neighbors still feel it.
 */
export function regionBands(bands: readonly Band[]): Force<SimNode, SimLink> {
	const count = bands.length;
	const depth = new Int32Array(count);
	for (let i = 0; i < count; i++) for (let p = bands[i]!.parent; p >= 0; p = bands[p]!.parent) depth[i]!++;
	const outerFirst = Array.from({ length: count }, (_, i) => i).sort((a, b) => depth[a]! - depth[b]! || a - b);
	const innerFirst = [...outerFirst].reverse();

	const groups = new Map<number, number[]>();
	bands.forEach((band, i) => {
		const group = groups.get(band.parent);
		if (group) group.push(i);
		else groups.set(band.parent, [i]);
	});
	const siblings = [...groups.values()].filter((group) => group.length > 1);

	const held = new Uint8Array(count);
	for (const i of innerFirst) {
		const band = bands[i]!;
		if (band.hub?.fx != null || band.direct.some((n) => n.fx != null)) held[i] = 1;
		if (held[i] && band.parent >= 0) held[band.parent] = 1;
	}

	const minX = new Float64Array(count);
	const maxX = new Float64Array(count);
	const minY = new Float64Array(count);
	const maxY = new Float64Array(count);
	const sumY = new Float64Array(count);
	const dots = new Int32Array(count);
	const push = new Float64Array(count);

	return (alpha: number): void => {
		if (!siblings.length) return;
		minX.fill(Infinity);
		maxX.fill(-Infinity);
		minY.fill(Infinity);
		maxY.fill(-Infinity);
		sumY.fill(0);
		dots.fill(0);
		push.fill(0);
		for (const i of innerFirst) {
			for (const n of bands[i]!.direct) {
				minX[i] = Math.min(minX[i]!, n.x - n.r);
				maxX[i] = Math.max(maxX[i]!, n.x + n.r);
				minY[i] = Math.min(minY[i]!, n.y - n.r);
				maxY[i] = Math.max(maxY[i]!, n.y + n.r);
				sumY[i]! += n.y;
				dots[i]!++;
			}
			const p = bands[i]!.parent;
			if (p < 0) continue;
			minX[p] = Math.min(minX[p]!, minX[i]!);
			maxX[p] = Math.max(maxX[p]!, maxX[i]!);
			minY[p] = Math.min(minY[p]!, minY[i]!);
			maxY[p] = Math.max(maxY[p]!, maxY[i]!);
			sumY[p]! += sumY[i]!;
			dots[p]! += dots[i]!;
		}
		const centerY = (i: number): number => sumY[i]! / dots[i]!;
		const half = (i: number): number => Math.max(maxY[i]! - centerY(i), centerY(i) - minY[i]!);

		for (const group of siblings) {
			// A sweep along x, so only siblings whose stretches of time meet are compared.
			group.sort((a, b) => minX[a]! - minX[b]! || a - b);
			for (let p = 0; p < group.length; p++) {
				const left = group[p]!;
				for (let q = p + 1; q < group.length && minX[group[q]!]! <= maxX[left]! + REGION_BAND_GAP; q++) {
					const right = group[q]!;
					// Level regions part in list order, which is key order, so it's deterministic.
					const a = Math.min(left, right);
					const b = Math.max(left, right);
					const want = half(a) + half(b) + REGION_BAND_GAP;
					const dy = centerY(b) - centerY(a);
					if (Math.abs(dy) >= want) continue;
					const f = ((dy >= 0 ? 1 : -1) * want - dy) * alpha * REGION_BAND_STRENGTH;
					push[a]! -= f / 2;
					push[b]! += f / 2;
				}
			}
		}

		// A band moves with every band around it.
		for (const i of outerFirst) {
			const p = bands[i]!.parent;
			if (held[i]) push[i] = 0;
			if (p >= 0) push[i]! += push[p]!;
			const shift = push[i]!;
			if (shift === 0) continue;
			const { hub, direct } = bands[i]!;
			if (hub) hub.vy += shift;
			for (const n of direct) n.vy += shift;
		}
	};
}
