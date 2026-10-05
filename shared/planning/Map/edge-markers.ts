import { intersects, type Box } from './box-index';
import type { Transform } from './camera';
import type { MapPoint } from './layout/types';

/**
 * Off-screen indicators (spec, Agents and What shows when): a mark at the plot's edge,
 * pointing toward something the viewport doesn't show. One layer for every kind: live
 * sessions and items that need a person, and the up-next markers. A marker sits where the
 * line from the middle of the plot to its target crosses the plot's edge, slides along the
 * edge to stay clear of the toolbar, the minimap, and each other, and stands for several
 * targets of its kind when they would crowd.
 */

export type EdgeMarkerKind = 'live' | 'needs-person' | 'up-next';

export interface EdgeTarget {
	/** What the marker flies to: an item's key, or a session's layout node. */
	key: string;
	kind: EdgeMarkerKind;
	/** What a screen reader says for the marker when this is the nearest target it stands for. */
	label: string;
	/** Layout units. */
	at: MapPoint;
}

export interface EdgeMarker {
	kind: EdgeMarkerKind;
	/** The nearest target it stands for, which a click flies to. */
	key: string;
	label: string;
	/** How many targets it stands for, that one included. */
	count: number;
	/** Center, in plot pixels. */
	x: number;
	y: number;
	/** Toward the target, in radians from the positive x axis (screen y runs down). */
	angle: number;
}

/** A marker is this many px across, and keeps this far inside the plot's edge. */
export const MARKER_SIZE = 28;
const EDGE_INSET = 6;
/** Boxes the marker keeps off are inflated by this much. */
const CLEAR = 4;
const STEP = 4;

export interface EdgeMarkerInput {
	targets: readonly EdgeTarget[];
	transform: Transform;
	/** The part of the canvas a person can see the Map in: the plot less what the drawer covers. */
	plot: Box;
	/** The toolbar and the minimap, which markers keep clear of. */
	reserved: readonly Box[];
}

type Side = 'left' | 'right' | 'top' | 'bottom';

interface Candidate {
	kind: EdgeMarkerKind;
	key: string;
	label: string;
	count: number;
	x: number;
	y: number;
	angle: number;
	side: Side;
	/** How far past the plot the target is; the nearest of several stands for them. */
	distance: number;
}

const inflate = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by });

const boxOf = (x: number, y: number): Box => ({ x: x - MARKER_SIZE / 2, y: y - MARKER_SIZE / 2, w: MARKER_SIZE, h: MARKER_SIZE });

const inside = (plot: Box, p: MapPoint): boolean => p.x >= plot.x && p.x <= plot.x + plot.w && p.y >= plot.y && p.y <= plot.y + plot.h;

function distanceOutside(plot: Box, p: MapPoint): number {
	const dx = Math.max(plot.x - p.x, 0, p.x - (plot.x + plot.w));
	const dy = Math.max(plot.y - p.y, 0, p.y - (plot.y + plot.h));
	return Math.hypot(dx, dy);
}

/**
 * Where the ray from the plot's middle toward `p` meets the rectangle a marker's center is
 * held to, and which side of it that is.
 */
function onEdge(inner: Box, plot: Box, p: MapPoint): { x: number; y: number; side: Side } {
	const cx = plot.x + plot.w / 2;
	const cy = plot.y + plot.h / 2;
	const dx = p.x - cx;
	const dy = p.y - cy;
	const tx = dx === 0 ? Infinity : ((dx > 0 ? inner.x + inner.w : inner.x) - cx) / dx;
	const ty = dy === 0 ? Infinity : ((dy > 0 ? inner.y + inner.h : inner.y) - cy) / dy;
	const t = Math.min(tx, ty);
	const side: Side = tx <= ty ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
	return { x: cx + dx * t, y: cy + dy * t, side };
}

/** The nearest position along the edge (offsets 0, then either way by growing steps) where the marker's box is clear of `blocked`, or null. */
function slide(at: { x: number; y: number }, side: Side, inner: Box, blocked: readonly Box[]): { x: number; y: number } | null {
	const vertical = side === 'left' || side === 'right';
	const lo = vertical ? inner.y : inner.x;
	const hi = vertical ? inner.y + inner.h : inner.x + inner.w;
	const start = vertical ? at.y : at.x;
	for (let offset = 0; offset <= hi - lo; offset += STEP) {
		for (const sign of offset === 0 ? [1] : [1, -1]) {
			const along = start + sign * offset;
			if (along < lo || along > hi) continue;
			const x = vertical ? at.x : along;
			const y = vertical ? along : at.y;
			const box = inflate(boxOf(x, y), CLEAR);
			if (!blocked.some((other) => intersects(box, other))) return { x, y };
		}
	}
	return null;
}

export function placeEdgeMarkers({ targets, transform, plot, reserved }: EdgeMarkerInput): EdgeMarker[] {
	const half = MARKER_SIZE / 2 + EDGE_INSET;
	const inner: Box = { x: plot.x + half, y: plot.y + half, w: Math.max(0, plot.w - 2 * half), h: Math.max(0, plot.h - 2 * half) };

	const candidates: Candidate[] = [];
	for (const target of targets) {
		const p = { x: transform.x + transform.k * target.at.x, y: transform.y + transform.k * target.at.y };
		if (inside(plot, p)) continue;
		const edge = onEdge(inner, plot, p);
		const angle = Math.atan2(p.y - (plot.y + plot.h / 2), p.x - (plot.x + plot.w / 2));
		candidates.push({ kind: target.kind, key: target.key, label: target.label, count: 1, ...edge, angle, distance: distanceOutside(plot, p) });
	}
	// Nearest first, so a marker that stands for several is named for the closest, and ties fall the same way every frame.
	candidates.sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

	const blocked = reserved.map((box) => inflate(box, CLEAR));
	const placed: Candidate[] = [];
	for (const candidate of candidates) {
		const at = slide(candidate, candidate.side, inner, blocked);
		if (!at) continue;
		const box = boxOf(at.x, at.y);
		// Crowding its own kind: stand for it instead, and count it.
		const same = placed.find((other) => other.kind === candidate.kind && intersects(inflate(boxOf(other.x, other.y), CLEAR), box));
		if (same) {
			same.count += candidate.count;
			continue;
		}
		const clear = slide(at, candidate.side, inner, [...blocked, ...placed.map((other) => inflate(boxOf(other.x, other.y), CLEAR))]);
		if (clear) placed.push({ ...candidate, ...clear });
	}
	return placed.map(({ kind, key, label, count, x, y, angle }) => ({ kind, key, label, count, x, y, angle }));
}
