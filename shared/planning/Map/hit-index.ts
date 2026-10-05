import type { Box } from './box-index';
import type { Transform } from './camera';
import { type CollapseControl, controlAt } from './collapse-controls';
import { MARK_REACH, agentRadius, screenPoint, screenRadius } from './dot-boxes';
import type { DrawAgent, DrawDot } from './draw-list';
import type { MapPoint } from './layout/types';
import type { RegionLabel } from './region-labels';
import type { RegionOutline } from './regions/outline';
import { cardBox } from './cards/card-culling';
import type { ZoomLevel } from './zoom-levels';

/**
 * What is under a point in the plot (spec, Navigation and interaction): one index over
 * the drawn dots, the cards standing in for them, region labels, region outlines, and
 * collapse controls, at the sizes the current frame drew them. Precedence follows what
 * sits on top of what: a control, then a dot, then a computer or session (which never
 * overlap a dot), then a card's body, then a region's label, then the region's own ground,
 * the innermost region winning.
 */
export type Hit =
	| { type: 'control'; key: string; collapse: boolean }
	/** `part` says which of the dot a point is on: its glyph, or the near-level card that stands in for it. */
	| { type: 'dot'; key: string; part: 'glyph' | 'card' }
	/** A computer or a session, by its layout node's key. */
	| { type: 'agent'; key: string }
	| { type: 'label'; key: string }
	| { type: 'region'; key: string };

/** What a frame drew, which is all the index reads. */
export interface HitInput {
	transform: Transform;
	level: ZoomLevel;
	dots: readonly DrawDot[];
	/** The dots that carry a near-level card. */
	cards: readonly DrawDot[];
	agents: readonly DrawAgent[];
	labels: readonly RegionLabel[];
	controls: readonly CollapseControl[];
	outlines: readonly RegionOutline[];
}

/** A dot is hit this far past its edge, and never by less than this radius: a leaf at fit all is 2 px. */
const DOT_SLOP = 2;
export const FINE_MIN_RADIUS = 6;
/** Wherever dots are tappable a coarse pointer gets targets 44 px across. */
export const COARSE_MIN_RADIUS = 22;

const CELL = 48;
const cellKey = (cx: number, cy: number): number => cx * 100_003 + cy;

interface Placed {
	dot: DrawDot;
	x: number;
	y: number;
	/** The glyph's radius on screen, with its marks. */
	r: number;
}

export class HitIndex {
	private readonly input: HitInput;
	private readonly cells = new Map<number, Placed[]>();
	private readonly labels: readonly RegionLabel[];
	/** The furthest any dot is hit from its center, which is how far a query looks past its own cell. */
	private widest = 0;

	constructor(input: HitInput) {
		this.input = input;
		this.labels = input.labels;
		const { transform, level } = input;
		for (const dot of input.dots) {
			const r = screenRadius(dot, transform.k, level) + MARK_REACH;
			const x = transform.x + transform.k * dot.x;
			const y = transform.y + transform.k * dot.y;
			const placed: Placed = { dot, x, y, r };
			this.widest = Math.max(this.widest, r + DOT_SLOP);
			const cx = Math.floor(x / CELL);
			const cy = Math.floor(y / CELL);
			const key = cellKey(cx, cy);
			const bucket = this.cells.get(key);
			if (bucket) bucket.push(placed);
			else this.cells.set(key, [placed]);
		}
	}

	/** The topmost thing at `point`, for a fine pointer or a coarse one. */
	at(point: MapPoint, coarse: boolean): Hit | null {
		const control = controlAt(this.input.controls, point, coarse ? COARSE_MIN_RADIUS : 0);
		if (control) return { type: 'control', key: control.key, collapse: control.collapse };
		const dot = this.dotAt(point, coarse);
		if (dot) return { type: 'dot', key: dot.key, part: 'glyph' };
		const agent = this.agentAt(point, coarse);
		if (agent) return { type: 'agent', key: agent.key };
		const card = this.cardAt(point);
		if (card) return { type: 'dot', key: card.key, part: 'card' };
		for (let i = this.labels.length - 1; i >= 0; i--) {
			const label = this.labels[i]!;
			if (label.alpha >= 0.5 && inside(label.box, point)) return { type: 'label', key: label.key };
		}
		const region = this.regionAt(point);
		return region ? { type: 'region', key: region.key } : null;
	}

	/** The dot whose center is nearest, among those the point is within reach of. */
	private dotAt(point: MapPoint, coarse: boolean): DrawDot | null {
		const floor = coarse ? COARSE_MIN_RADIUS : FINE_MIN_RADIUS;
		const cx = Math.floor(point.x / CELL);
		const cy = Math.floor(point.y / CELL);
		const reach = Math.max(1, Math.ceil(Math.max(floor, this.widest) / CELL));
		let best: DrawDot | null = null;
		let bestDistance = Infinity;
		for (let dx = -reach; dx <= reach; dx++) {
			for (let dy = -reach; dy <= reach; dy++) {
				const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
				if (!bucket) continue;
				for (const placed of bucket) {
					const distance = Math.hypot(point.x - placed.x, point.y - placed.y);
					if (distance <= Math.max(placed.r + DOT_SLOP, floor) && distance < bestDistance) {
						best = placed.dot;
						bestDistance = distance;
					}
				}
			}
		}
		return best;
	}

	/** The computer or session whose center is nearest, among those the point is within reach of. */
	private agentAt(point: MapPoint, coarse: boolean): DrawAgent | null {
		const { agents, transform, level } = this.input;
		const floor = coarse ? COARSE_MIN_RADIUS : FINE_MIN_RADIUS;
		let best: DrawAgent | null = null;
		let bestDistance = Infinity;
		for (const agent of agents) {
			const at = screenPoint(transform, agent);
			const distance = Math.hypot(point.x - at.x, point.y - at.y);
			if (distance <= Math.max(agentRadius(agent, transform.k, level) + DOT_SLOP, floor) && distance < bestDistance) {
				best = agent;
				bestDistance = distance;
			}
		}
		return best;
	}

	/** A card is hit anywhere on its body; the one drawn last (furthest right) is on top. */
	private cardAt(point: MapPoint): DrawDot | null {
		const { cards, transform } = this.input;
		for (let i = cards.length - 1; i >= 0; i--) {
			if (inside(cardBox(cards[i]!, transform), point)) return cards[i]!;
		}
		return null;
	}

	/** The innermost region whose outline holds the point. */
	private regionAt(point: MapPoint): RegionOutline | null {
		const { outlines, transform } = this.input;
		const x = (point.x - transform.x) / transform.k;
		const y = (point.y - transform.y) / transform.k;
		let best: RegionOutline | null = null;
		for (const outline of outlines) {
			const { bounds } = outline;
			if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
			if (best && (outline.height > best.height || (outline.height === best.height && outline.depth < best.depth))) continue;
			if (contains(outline.loop, x, y)) best = outline;
		}
		return best;
	}
}

const inside = (box: Box, p: MapPoint): boolean => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/** Even-odd point in polygon over a loop of x, y pairs. */
export function contains(loop: Float64Array, x: number, y: number): boolean {
	let odd = false;
	const n = loop.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = loop[2 * i]!;
		const yi = loop[2 * i + 1]!;
		const xj = loop[2 * j]!;
		const yj = loop[2 * j + 1]!;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
	}
	return odd;
}
