import type { Force } from 'd3-force';
import { REPULSION, REPULSION_RANGE, SEPARATION_FACTOR, SEPARATION_RANGE } from './constants';
import type { SimLink, SimNode } from './forces';
import { CellIndex } from './grid';

/** Wide enough that the eight neighboring cells cover the separation range. */
const CELL = Math.max(SEPARATION_RANGE, REPULSION_RANGE / 4);
const NO_FAMILY = -1;
/** Sessions and computers repel but take no part in family separation. */
const NOT_SEPARATED = -2;

/**
 * Repulsion between dots, ignored past its range, with the family separation folded
 * into the same pass: within a shorter range, dots of different families (or a loose
 * dot and a family) push apart harder, so regions get clean ground. Hubs take no
 * space and sit out.
 *
 * Dots go into a grid. Pairs in the same or neighboring cells, which covers the
 * separation range, are exact and each is computed once. Every farther cell in range
 * acts as one body at its centroid on the cell as a whole: Barnes-Hut flattened onto
 * a grid. d3's forceManyBody measured about 7 ms a tick at 1,000 nodes, and exact
 * pairs over the whole range about 4 ms, against a budget of under 1 ms.
 */
export function spacing(): Force<SimNode, SimLink> {
	let nodes: SimNode[] = [];
	let random!: () => number;
	let families = new Int32Array(0);
	let xs = new Float64Array(0);
	let ys = new Float64Array(0);
	let sortedFamily = new Int32Array(0);
	let ax = new Float64Array(0);
	let ay = new Float64Array(0);
	let centroidX = new Float64Array(0);
	let centroidY = new Float64Array(0);
	const grid = new CellIndex();
	const range2 = REPULSION_RANGE * REPULSION_RANGE;
	const separation2 = SEPARATION_RANGE * SEPARATION_RANGE;
	const separated = 1 + SEPARATION_FACTOR;

	const force = (alpha: number): void => {
		const count = nodes.length;
		if (count < 2) return;
		for (let i = 0; i < count; i++) {
			xs[i] = nodes[i]!.x;
			ys[i] = nodes[i]!.y;
		}
		const width = grid.build(xs, ys, count, CELL);
		const { columns, rows, cells, start, x, y, point } = grid;
		const reach = Math.ceil(REPULSION_RANGE / width);
		const fs = sortedFamily;
		const fx = ax;
		const fy = ay;
		for (let k = 0; k < count; k++) {
			fs[k] = families[point[k]!]!;
			fx[k] = 0;
			fy[k] = 0;
		}
		if (centroidX.length < cells) {
			centroidX = new Float64Array(cells);
			centroidY = new Float64Array(cells);
		}
		const mx = centroidX;
		const my = centroidY;
		for (let c = 0; c < cells; c++) {
			const from = start[c]!;
			const to = start[c + 1]!;
			if (from === to) continue;
			let sx = 0;
			let sy = 0;
			for (let k = from; k < to; k++) {
				sx += x[k]!;
				sy += y[k]!;
			}
			mx[c] = sx / (to - from);
			my[c] = sy / (to - from);
		}

		const charge = -REPULSION * alpha;
		for (let cy = 0; cy < rows; cy++) {
			for (let cx = 0; cx < columns; cx++) {
				const c = cx + cy * columns;
				const end = start[c + 1]!;
				if (start[c] === end) continue;

				// Exact pairs: this cell with itself, the cell to its right, and the three
				// below, so each neighboring pair comes up once.
				const rightEnd = cx + 1 < columns ? start[c + 2]! : end;
				const belowFrom = cy + 1 < rows ? start[Math.max(0, cx - 1) + (cy + 1) * columns]! : 0;
				const belowTo = cy + 1 < rows ? start[Math.min(columns - 1, cx + 1) + (cy + 1) * columns + 1]! : 0;
				for (let k = start[c]!; k < end; k++) {
					const xk = x[k]!;
					const yk = y[k]!;
					const fk = fs[k]!;
					let sumX = 0;
					let sumY = 0;
					for (let pass = 0; pass < 2; pass++) {
						const from = pass === 0 ? k + 1 : belowFrom;
						const to = pass === 0 ? rightEnd : belowTo;
						for (let m = from; m < to; m++) {
							let dx = x[m]! - xk;
							let dy = y[m]! - yk;
							let d2 = dx * dx + dy * dy;
							if (d2 > range2) continue;
							if (d2 < 1) {
								dx = random() - 0.5;
								dy = random() - 0.5;
								d2 = 1;
							}
							let w = charge / d2;
							const fm = fs[m]!;
							if (d2 < separation2 && fk !== fm && fk !== NOT_SEPARATED && fm !== NOT_SEPARATED) w *= separated;
							dx *= w;
							dy *= w;
							sumX += dx;
							sumY += dy;
							fx[m]! -= dx;
							fy[m]! -= dy;
						}
					}
					fx[k]! += sumX;
					fy[k]! += sumY;
				}

				// Farther cells in range, as bodies at their centroids, felt at this cell's.
				const ox0 = mx[c]!;
				const oy0 = my[c]!;
				let farX = 0;
				let farY = 0;
				for (let oy = Math.max(0, cy - reach); oy <= Math.min(rows - 1, cy + reach); oy++) {
					const near = oy >= cy - 1 && oy <= cy + 1;
					for (let ox = Math.max(0, cx - reach); ox <= Math.min(columns - 1, cx + reach); ox++) {
						if (near && ox >= cx - 1 && ox <= cx + 1) continue;
						const o = ox + oy * columns;
						const bodies = start[o + 1]! - start[o]!;
						if (bodies === 0) continue;
						const dx = mx[o]! - ox0;
						const dy = my[o]! - oy0;
						const d2 = dx * dx + dy * dy;
						if (d2 > range2) continue;
						const w = (charge * bodies) / d2;
						farX += dx * w;
						farY += dy * w;
					}
				}
				if (farX !== 0 || farY !== 0) {
					for (let k = start[c]!; k < end; k++) {
						fx[k]! += farX;
						fy[k]! += farY;
					}
				}
			}
		}
		for (let k = 0; k < count; k++) {
			const n = nodes[point[k]!]!;
			n.vx += fx[k]!;
			n.vy += fy[k]!;
		}
	};
	force.initialize = (all: SimNode[], source: () => number): void => {
		nodes = all.filter((n) => !n.hub);
		random = source;
		const codes = new Map<string, number>();
		families = Int32Array.from(nodes, (n) => {
			if (n.family === undefined) return NOT_SEPARATED;
			if (n.family === null) return NO_FAMILY;
			if (!codes.has(n.family)) codes.set(n.family, codes.size);
			return codes.get(n.family)!;
		});
		xs = new Float64Array(nodes.length);
		ys = new Float64Array(nodes.length);
		sortedFamily = new Int32Array(nodes.length);
		ax = new Float64Array(nodes.length);
		ay = new Float64Array(nodes.length);
	};
	return force;
}
