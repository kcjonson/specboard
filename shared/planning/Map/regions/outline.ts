import type { MapBounds, MapPoint } from '../layout/types';

/**
 * Region outlines (spec, Regions), drawn the way Bubble Sets (Collins, Penn, and
 * Carpendale, 2009) draws a set over a layout it doesn't move. Each member raises a
 * field around itself and a spanning tree between the members adds a thin corridor,
 * so a family stays one piece and a long-running epic reads as bulbs on a neck. A
 * closing (grow, then shrink back) fills narrow inlets. Each region keeps only the
 * ground where it beats every unrelated neighbor by a margin, so neighbors meet at a
 * shared edge, and a nested region keeps only ground inside its parent. Marching
 * squares trace the level, one outer loop survives, and it's smoothed.
 *
 * Distances are layout units, the units the layout spaced families in; only the grid
 * follows the zoom, so the outline is resolved to a few pixels on screen.
 */

/** A member's field reaches its radius plus this, plus NEST_PAD per level of nesting inside. */
export const REGION_PAD = 32;
export const NEST_PAD = 12;
/** Padding grows for this many levels of nesting and no more, so a deep hierarchy can't grow a region's grid without bound. */
const NEST_PAD_LEVELS = 4;
/** The spanning tree's corridor reaches this share of the pad, at this strength. */
const CORRIDOR_REACH = 0.375;
const CORRIDOR_STRENGTH = 0.7;
/** The closing's disk, and the grid it runs on. */
export const CLOSE_RADIUS = 20;
const CLOSE_STEP = 10;
/** The field level the outline traces. */
export const REGION_LEVEL = 0.22;
/** A region keeps ground only where its field beats an unrelated neighbor's by this. */
export const RIVAL_MARGIN = 0.06;
/** A nested region keeps ground only where its parent's field clears the level by this, so it sits inside with room. */
const NEST_MARGIN = 0.06;

export interface RegionMember extends MapPoint {
	r: number;
}

export interface RegionInput {
	key: string;
	/** The enclosing region's key, null at the top level. */
	parentKey: string | null;
	/** 1 for a region with no region inside it, one more per level of regions nested inside. */
	height: number;
	/** Every dot drawn inside it, nested regions' dots included. */
	members: readonly RegionMember[];
}

export interface RegionOutline {
	key: string;
	depth: number;
	height: number;
	/** The traced boundary before smoothing, as x, y pairs. */
	loop: Float64Array;
	/** The smoothed boundary: a start point, then a control point and an end point per quadratic curve. */
	curve: Float64Array;
	bounds: MapBounds;
	/** The highest and lowest points on the smoothed boundary, where a label can sit. */
	top: MapPoint;
	bottom: MapPoint;
}

/** A field sampled at the grid points (i * step, j * step) for i in [i0, i0 + nx), j in [j0, j0 + ny). */
interface Field {
	i0: number;
	j0: number;
	nx: number;
	ny: number;
	values: Float32Array;
}

function sample(field: Field, i: number, j: number): number {
	const x = i - field.i0;
	const y = j - field.j0;
	return x < 0 || y < 0 || x >= field.nx || y >= field.ny ? 0 : field.values[y * field.nx + x]!;
}

/**
 * A spanning tree over the members that's minimal or nearly so, as index pairs. Exact
 * Prim is quadratic, which one huge epic can't afford on the main thread, so this is
 * Kruskal over candidate pairs from a uniform grid: every pair in the same or adjacent
 * cells, shortest first. A grid too fine to connect everything doubles and goes again,
 * pairing only points not yet joined, and skipping cell pairs that hold one component.
 */
export function spanningTree(points: readonly MapPoint[]): Array<[number, number]> {
	const count = points.length;
	const edges: Array<[number, number]> = [];
	if (count < 2) return edges;
	const root = Int32Array.from({ length: count }, (_, i) => i);
	const find = (i: number): number => {
		while (root[i] !== i) {
			root[i] = root[root[i]!]!;
			i = root[i]!;
		}
		return i;
	};
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	// About two points per cell where the members spread evenly.
	let cell = Math.max(1, Math.sqrt((2 * Math.max(1, maxX - minX) * Math.max(1, maxY - minY)) / count));
	let components = count;
	while (components > 1) {
		const cells = new Map<string, number[]>();
		const keyOf = (cx: number, cy: number): string => `${cx},${cy}`;
		for (let i = 0; i < count; i++) {
			const key = keyOf(Math.floor((points[i]!.x - minX) / cell), Math.floor((points[i]!.y - minY) / cell));
			const members = cells.get(key);
			if (members) members.push(i);
			else cells.set(key, [i]);
		}
		// A cell whose points are all one component, or -1 when it mixes them.
		const uniform = new Map<string, number>();
		for (const [key, members] of cells) {
			const c = find(members[0]!);
			uniform.set(key, members.every((i) => find(i) === c) ? c : -1);
		}
		const from: number[] = [];
		const to: number[] = [];
		const length: number[] = [];
		const pair = (a: number[], b: number[], same: boolean): void => {
			for (let x = 0; x < a.length; x++) {
				for (let y = same ? x + 1 : 0; y < b.length; y++) {
					const i = a[x]!;
					const j = b[y]!;
					if (find(i) === find(j)) continue;
					from.push(i);
					to.push(j);
					length.push((points[i]!.x - points[j]!.x) ** 2 + (points[i]!.y - points[j]!.y) ** 2);
				}
			}
		};
		for (const [key, members] of cells) {
			const [cx, cy] = key.split(',').map(Number) as [number, number];
			const mine = uniform.get(key)!;
			// Each neighboring pair of cells once: this cell, then the four ahead of it.
			for (const [dx, dy] of [[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
				const other = keyOf(cx + dx, cy + dy);
				const theirs = cells.get(other);
				if (!theirs) continue;
				const them = uniform.get(other)!;
				if (mine !== -1 && mine === them) continue;
				pair(members, theirs, dx === 0 && dy === 0);
			}
		}
		const order = Array.from(length.keys()).sort((a, b) => length[a]! - length[b]!);
		for (const k of order) {
			const a = find(from[k]!);
			const b = find(to[k]!);
			if (a === b) continue;
			root[a] = b;
			edges.push([from[k]!, to[k]!]);
			components--;
		}
		cell *= 2;
	}
	return edges;
}

/** Members' boxes with room for the field, the closing, and a border of zeros, so every contour closes. */
function extentOf(members: readonly RegionMember[], pad: number): MapBounds {
	const margin = pad + CLOSE_RADIUS + 2 * CLOSE_STEP;
	const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
	for (const m of members) {
		bounds.minX = Math.min(bounds.minX, m.x - m.r - margin);
		bounds.minY = Math.min(bounds.minY, m.y - m.r - margin);
		bounds.maxX = Math.max(bounds.maxX, m.x + m.r + margin);
		bounds.maxY = Math.max(bounds.maxY, m.y + m.r + margin);
	}
	return bounds;
}

/** Each member's bump and the tree's corridors, splatted onto a grid of `step` over `extent`. */
function rawField(members: readonly RegionMember[], tree: ReadonlyArray<[number, number]>, pad: number, extent: MapBounds, step: number): Field {
	const i0 = Math.floor(extent.minX / step);
	const j0 = Math.floor(extent.minY / step);
	const nx = Math.ceil(extent.maxX / step) - i0 + 1;
	const ny = Math.ceil(extent.maxY / step) - j0 + 1;
	const values = new Float32Array(nx * ny);

	// Cells within reach of a box, clipped to the grid.
	const span = (lo: number, hi: number, origin: number, size: number): [number, number] => [
		Math.max(0, Math.ceil(lo / step) - origin),
		Math.min(size - 1, Math.floor(hi / step) - origin),
	];

	for (const m of members) {
		const reach = m.r + pad;
		const [ia, ib] = span(m.x - reach, m.x + reach, i0, nx);
		const [ja, jb] = span(m.y - reach, m.y + reach, j0, ny);
		for (let j = ja; j <= jb; j++) {
			const dy = (j0 + j) * step - m.y;
			for (let i = ia; i <= ib; i++) {
				const dx = (i0 + i) * step - m.x;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d < reach) {
					const t = 1 - d / reach;
					values[j * nx + i]! += t * t;
				}
			}
		}
	}

	const reach = pad * CORRIDOR_REACH;
	for (const [a, b] of tree) {
		const p = members[a]!;
		const q = members[b]!;
		const vx = q.x - p.x;
		const vy = q.y - p.y;
		const length2 = vx * vx + vy * vy || 1;
		const [ia, ib] = span(Math.min(p.x, q.x) - reach, Math.max(p.x, q.x) + reach, i0, nx);
		const [ja, jb] = span(Math.min(p.y, q.y) - reach, Math.max(p.y, q.y) + reach, j0, ny);
		for (let j = ja; j <= jb; j++) {
			const y = (j0 + j) * step;
			for (let i = ia; i <= ib; i++) {
				const x = (i0 + i) * step;
				const t = Math.max(0, Math.min(1, ((x - p.x) * vx + (y - p.y) * vy) / length2));
				const d = Math.hypot(p.x + t * vx - x, p.y + t * vy - y);
				if (d < reach) {
					const s = 1 - d / reach;
					values[j * nx + i]! += CORRIDOR_STRENGTH * s * s;
				}
			}
		}
	}
	return { i0, j0, nx, ny, values };
}

/**
 * The max over a disk of `radius` cells, everything off the grid read as 0. The disk
 * splits into one row per offset, so each cell takes 2 * radius + 1 lookups into
 * running row maxima.
 */
function dilate(field: Field, radius: number): Field {
	const { nx, ny, values } = field;
	const half = Array.from({ length: radius + 1 }, (_, d) => Math.floor(Math.sqrt(radius * radius - d * d)));
	// rows[w] holds the max over [i - w, i + w] in the same row.
	const rows: Float32Array[] = [values];
	for (let w = 1; w <= radius; w++) {
		const prev = rows[w - 1]!;
		const next = new Float32Array(nx * ny);
		for (let j = 0; j < ny; j++) {
			const row = j * nx;
			for (let i = 0; i < nx; i++) {
				let v = prev[row + i]!;
				const left = i - w >= 0 ? values[row + i - w]! : 0;
				const right = i + w < nx ? values[row + i + w]! : 0;
				if (left > v) v = left;
				if (right > v) v = right;
				next[row + i] = v;
			}
		}
		rows.push(next);
	}
	const out = new Float32Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) {
			let v = rows[half[0]!]![j * nx + i]!;
			for (let d = 1; d <= radius; d++) {
				const w = rows[half[d]!]!;
				const above = j - d >= 0 ? w[(j - d) * nx + i]! : 0;
				const below = j + d < ny ? w[(j + d) * nx + i]! : 0;
				if (above > v) v = above;
				if (below > v) v = below;
			}
			out[j * nx + i] = v;
		}
	}
	return { ...field, values: out };
}

function negate(field: Field): Field {
	return { ...field, values: field.values.map((v) => -v) };
}

/** Grow, then shrink back: the min filter is the max filter of the negated field, and 0 off the grid stays 0. */
function closing(field: Field, radius: number): Field {
	return radius < 1 ? field : negate(dilate(negate(dilate(field, radius)), radius));
}

/**
 * The closed field on a grid of `step`. The closing runs on a grid of CLOSE_STEP
 * whatever the step: what it fills is inlets narrower than its disk, which that grid
 * resolves, and the disk filter is by far the costliest pass. On the working grid the
 * closed field is the larger of the raw field and the coarse closing read back
 * bilinearly, so the fine detail (a neck, a member at the edge) is the raw field's and
 * only the filling is the closing's. Closing never lowers a field, so neither does this.
 */
function closedField(members: readonly RegionMember[], pad: number, step: number): Field {
	const extent = extentOf(members, pad);
	const tree = spanningTree(members);
	const coarseStep = Math.max(step, CLOSE_STEP);
	const coarse = closing(rawField(members, tree, pad, extent, coarseStep), Math.round(CLOSE_RADIUS / coarseStep));
	if (coarseStep === step) return coarse;
	const fine = rawField(members, tree, pad, extent, step);
	const { i0, j0, nx, ny, values } = fine;
	for (let j = 0; j < ny; j++) {
		const gy = ((j0 + j) * step) / coarseStep;
		const cj = Math.floor(gy);
		const fy = gy - cj;
		for (let i = 0; i < nx; i++) {
			const gx = ((i0 + i) * step) / coarseStep;
			const ci = Math.floor(gx);
			const fx = gx - ci;
			const top = sample(coarse, ci, cj) * (1 - fx) + sample(coarse, ci + 1, cj) * fx;
			const bottom = sample(coarse, ci, cj + 1) * (1 - fx) + sample(coarse, ci + 1, cj + 1) * fx;
			const closed = top * (1 - fy) + bottom * fy;
			const k = j * nx + i;
			if (closed > values[k]!) values[k] = closed;
		}
	}
	return fine;
}

/** Marching squares at `level` over a field whose border is below it, so every contour closes. Returns each loop as x, y pairs. */
export function traceLoops(field: Field, level: number, step: number): Float64Array[] {
	const { i0, j0, nx, ny, values } = field;
	const at = (i: number, j: number): number => values[j * nx + i]!;
	// Edge ids: 2 * cell for the horizontal edge from (i, j) to (i + 1, j), plus 1 for the vertical one down to (i, j + 1).
	const top = (i: number, j: number): number => 2 * (j * nx + i);
	const left = (i: number, j: number): number => 2 * (j * nx + i) + 1;
	const segments: number[] = [];
	for (let j = 0; j < ny - 1; j++) {
		for (let i = 0; i < nx - 1; i++) {
			const tl = at(i, j);
			const tr = at(i + 1, j);
			const br = at(i + 1, j + 1);
			const bl = at(i, j + 1);
			const c = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
			if (c === 0 || c === 15) continue;
			const T = top(i, j);
			const B = top(i, j + 1);
			const L = left(i, j);
			const R = left(i + 1, j);
			const centerIn = (tl + tr + br + bl) / 4 > level;
			switch (c) {
				case 1: case 14: segments.push(L, B); break;
				case 2: case 13: segments.push(B, R); break;
				case 3: case 12: segments.push(L, R); break;
				case 4: case 11: segments.push(T, R); break;
				case 6: case 9: segments.push(T, B); break;
				case 7: case 8: segments.push(L, T); break;
				// Saddles: the center decides which diagonal is inside.
				case 5:
					if (centerIn) segments.push(L, T, B, R);
					else segments.push(T, R, L, B);
					break;
				case 10:
					if (centerIn) segments.push(T, R, L, B);
					else segments.push(L, T, B, R);
					break;
			}
		}
	}

	const count = segments.length / 2;
	// Every edge on a closed contour belongs to exactly two segments.
	const first = new Int32Array(2 * nx * ny).fill(-1);
	const second = new Int32Array(2 * nx * ny).fill(-1);
	for (let s = 0; s < count; s++) {
		for (const e of [segments[2 * s]!, segments[2 * s + 1]!]) {
			if (first[e] === -1) first[e] = s;
			else second[e] = s;
		}
	}
	const point = (e: number, out: number[]): void => {
		const cell = e >> 1;
		const i = cell % nx;
		const j = (cell - i) / nx;
		const a = at(i, j);
		if (e & 1) {
			const t = (level - a) / (at(i, j + 1) - a);
			out.push((i0 + i) * step, (j0 + j + t) * step);
		} else {
			const t = (level - a) / (at(i + 1, j) - a);
			out.push((i0 + i + t) * step, (j0 + j) * step);
		}
	};

	const used = new Uint8Array(count);
	const loops: Float64Array[] = [];
	for (let s0 = 0; s0 < count; s0++) {
		if (used[s0]) continue;
		used[s0] = 1;
		const start = segments[2 * s0]!;
		let edge = segments[2 * s0 + 1]!;
		const coords: number[] = [];
		point(start, coords);
		while (edge !== start) {
			point(edge, coords);
			const a = first[edge]!;
			const next = a >= 0 && !used[a] ? a : second[edge]!;
			if (next < 0 || used[next]) break;
			used[next] = 1;
			edge = segments[2 * next]! === edge ? segments[2 * next + 1]! : segments[2 * next]!;
		}
		if (coords.length >= 6) loops.push(Float64Array.from(coords));
	}
	return loops;
}

export function loopArea(loop: Float64Array): number {
	let twice = 0;
	const n = loop.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) twice += (loop[2 * j]! + loop[2 * i]!) * (loop[2 * j + 1]! - loop[2 * i + 1]!);
	return Math.abs(twice / 2);
}

/** Even-odd ray cast. */
export function insideLoop(x: number, y: number, loop: Float64Array): boolean {
	let inside = false;
	const n = loop.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = loop[2 * i]!;
		const yi = loop[2 * i + 1]!;
		const xj = loop[2 * j]!;
		const yj = loop[2 * j + 1]!;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/**
 * Smooths a traced loop: each point becomes the control point of a quadratic curve
 * through the midpoints around it, which rounds off the grid's corners. A curve cuts
 * a concave corner by at most a quarter of a grid edge, which the hairline between
 * neighbors and the nesting margin both absorb; the outline tests check the drawn
 * curves as well as the traced loops.
 */
function smooth(loop: Float64Array): Pick<RegionOutline, 'curve' | 'bounds' | 'top' | 'bottom'> {
	const ring = loop;
	const m = ring.length / 2;
	const curve = new Float64Array(2 + 4 * m);
	const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
	let top = { x: 0, y: Infinity };
	let bottom = { x: 0, y: -Infinity };
	const midpoint = (a: number, b: number): [number, number] => [(ring[2 * a]! + ring[2 * b]!) / 2, (ring[2 * a + 1]! + ring[2 * b + 1]!) / 2];
	const [sx, sy] = midpoint(m - 1, 0);
	curve[0] = sx;
	curve[1] = sy;
	for (let i = 0; i < m; i++) {
		const cx = ring[2 * i]!;
		const cy = ring[2 * i + 1]!;
		const [ex, ey] = midpoint(i, (i + 1) % m);
		curve.set([cx, cy, ex, ey], 2 + 4 * i);
		// The curve stays inside the hull of its points, so the control points bound it.
		bounds.minX = Math.min(bounds.minX, cx);
		bounds.maxX = Math.max(bounds.maxX, cx);
		bounds.minY = Math.min(bounds.minY, cy);
		bounds.maxY = Math.max(bounds.maxY, cy);
		if (ey < top.y) top = { x: ex, y: ey };
		if (ey > bottom.y) bottom = { x: ex, y: ey };
	}
	return { curve, bounds, top, bottom };
}

/**
 * Zeroes every cell above the level that isn't connected (4-way) to the cell under
 * `seed`, so the field holds one piece of ground. Without a seed above the level it
 * leaves the field alone.
 */
function keepComponent(field: Field, seed: MapPoint | undefined, step: number): void {
	if (!seed) return;
	const { i0, j0, nx, ny, values } = field;
	let start = -1;
	const ci = Math.round(seed.x / step) - i0;
	const cj = Math.round(seed.y / step) - j0;
	for (let dj = -1; dj <= 1 && start < 0; dj++) {
		for (let di = -1; di <= 1 && start < 0; di++) {
			const i = ci + di;
			const j = cj + dj;
			if (i >= 0 && j >= 0 && i < nx && j < ny && values[j * nx + i]! > REGION_LEVEL) start = j * nx + i;
		}
	}
	if (start < 0) return;
	const kept = new Uint8Array(nx * ny);
	kept[start] = 1;
	const queue = [start];
	while (queue.length) {
		const k = queue.pop()!;
		const i = k % nx;
		for (const next of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
			if (next < 0 || next >= nx * ny || kept[next] || values[next]! <= REGION_LEVEL) continue;
			kept[next] = 1;
			queue.push(next);
		}
	}
	for (let k = 0; k < nx * ny; k++) if (!kept[k] && values[k]! > REGION_LEVEL) values[k] = 0;
}

interface Working {
	input: RegionInput;
	depth: number;
	ancestors: Set<string>;
	closed: Field;
	final: Field | null;
	bounds: MapBounds;
}

const overlaps = (a: MapBounds, b: MapBounds): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

/** The grid's extent in layout units. */
function fieldBounds(field: Field, step: number): MapBounds {
	return {
		minX: field.i0 * step,
		maxX: (field.i0 + field.nx - 1) * step,
		minY: field.j0 * step,
		maxY: (field.j0 + field.ny - 1) * step,
	};
}

/**
 * Every region's outline on a grid of `step` layout units, outer regions first. A
 * region with no members draws nothing. Fields share one lattice, so one region's
 * cell (i, j) is the same point as any other's.
 */
export function traceRegions(inputs: readonly RegionInput[], step: number): RegionOutline[] {
	const byKey = new Map(inputs.map((input) => [input.key, input]));
	const working: Working[] = [];
	for (const input of inputs) {
		if (!input.members.length) continue;
		const ancestors = new Set<string>();
		for (let p = input.parentKey; p && !ancestors.has(p); p = byKey.get(p)?.parentKey ?? null) ancestors.add(p);
		const closed = closedField(input.members, REGION_PAD + NEST_PAD * Math.min(input.height - 1, NEST_PAD_LEVELS), step);
		working.push({ input, depth: ancestors.size, ancestors, closed, final: null, bounds: fieldBounds(closed, step) });
	}
	working.sort((a, b) => a.depth - b.depth || (a.input.key < b.input.key ? -1 : a.input.key > b.input.key ? 1 : 0));
	const finals = new Map<string, Field>();

	const outlines: RegionOutline[] = [];
	for (const region of working) {
		const { closed } = region;
		const rivals = working.filter(
			(other) =>
				other !== region &&
				!region.ancestors.has(other.input.key) &&
				!other.ancestors.has(region.input.key) &&
				overlaps(region.bounds, other.bounds),
		);
		const parent = region.input.parentKey ? finals.get(region.input.parentKey) : undefined;
		const values = Float32Array.from(closed.values);
		const { i0, j0, nx, ny } = closed;
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const k = j * nx + i;
				const own = values[k]!;
				if (own <= 0) continue;
				// Each rival is weighed against this region's own field, so penalties never stack.
				let v = own;
				for (const rival of rivals) {
					const other = sample(rival.closed, i0 + i, j0 + j);
					if (other > 0) v = Math.min(v, REGION_LEVEL + (own - other) - RIVAL_MARGIN);
				}
				if (parent) v = Math.min(v, sample(parent, i0 + i, j0 + j) - NEST_MARGIN);
				values[k] = v;
			}
		}
		const final = { ...closed, values };
		finals.set(region.input.key, final);

		const loops = traceLoops(final, REGION_LEVEL, step);
		if (!loops.length) continue;
		// One solid shape: the loop holding the most members (the largest on a tie) stands, and holes and islands go.
		let loop = loops[0]!;
		let held = -1;
		let area = -1;
		for (const candidate of loops) {
			let count = 0;
			for (const m of region.input.members) if (insideLoop(m.x, m.y, candidate)) count++;
			const size = loopArea(candidate);
			if (count > held || (count === held && size > area)) {
				loop = candidate;
				held = count;
				area = size;
			}
		}
		// Nested regions are clamped under this field, so it keeps only the ground the drawn loop holds: a child on a dropped island would sit outside its parent.
		if (loops.length > 1) keepComponent(final, region.input.members.find((m) => insideLoop(m.x, m.y, loop)), step);
		outlines.push({ key: region.input.key, depth: region.depth, height: region.input.height, loop, ...smooth(loop) });
	}
	return outlines;
}
