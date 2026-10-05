import { intersects, type Box } from './box-index';
import type { MapPoint } from './layout/types';

/**
 * Off-screen indicators (spec, What shows when and Agents): an item the person should know
 * about that is out of view gets a marker at the plot's edge, pointing toward it. One layer
 * serves every kind (an up-next item, a live session, something that needs a person), so each
 * asks for its own markers with a key and a kind and the layer places them all.
 */
export type EdgeMarkerKind = 'up-next' | 'needs-person' | 'live';

export interface EdgeMarkerInput {
	/** The item the marker points to. */
	key: string;
	kind: EdgeMarkerKind;
	/** What the marker says: an up-next marker's number. */
	text?: string;
	/** What assistive tech calls the target when the key means nothing to a person (a session's node); the key otherwise. */
	label?: string;
}

export interface PlacedEdgeMarker extends EdgeMarkerInput {
	/** The marker's center, in plot pixels. */
	x: number;
	y: number;
	/** Radians from the marker toward its item, so the arrow can turn that way. */
	angle: number;
}

/** A marker is this many px across; it keeps `EDGE_INSET` from the plot's edge. */
export const EDGE_MARKER_SIZE = 26;
const EDGE_INSET = 10;
/** Markers keep this much clear of each other and of what is reserved. */
const GAP = 4;

type Side = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeMarkerPlacement {
	/** The part of the plot the person can see: the drawer covers the rest. */
	plot: Box;
	/** The toolbar, the stepping bar, the minimap, and anything else markers keep clear of. */
	avoid: readonly Box[];
	/** Where an item is on screen, in plot pixels; undefined when the Map doesn't draw it. */
	locate(key: string): MapPoint | undefined;
}

const within = (p: MapPoint, box: Box): boolean => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/**
 * Markers for the items that are out of view, in the order asked (which is the priority:
 * an earlier marker keeps its spot). Each goes where the line from the middle of the plot to
 * its item crosses the plot's edge, then slides along that edge to the nearest spot clear of
 * the reserved boxes and of the markers already placed.
 */
export function placeEdgeMarkers(inputs: readonly EdgeMarkerInput[], { plot, avoid, locate }: EdgeMarkerPlacement): PlacedEdgeMarker[] {
	const half = EDGE_MARKER_SIZE / 2;
	const room = { left: plot.x + EDGE_INSET + half, right: plot.x + plot.w - EDGE_INSET - half, top: plot.y + EDGE_INSET + half, bottom: plot.y + plot.h - EDGE_INSET - half };
	if (room.right < room.left || room.bottom < room.top) return [];
	const center = { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 };
	const placed: PlacedEdgeMarker[] = [];
	const boxOf = (x: number, y: number): Box => ({ x: x - half - GAP, y: y - half - GAP, w: EDGE_MARKER_SIZE + 2 * GAP, h: EDGE_MARKER_SIZE + 2 * GAP });

	for (const input of inputs) {
		const target = locate(input.key);
		if (!target || within(target, plot)) continue;
		const dx = target.x - center.x;
		const dy = target.y - center.y;
		// How far along the line to the item each edge of the room is; the nearer one is where it leaves the plot.
		const toX = dx === 0 ? Infinity : ((dx > 0 ? room.right : room.left) - center.x) / dx;
		const toY = dy === 0 ? Infinity : ((dy > 0 ? room.bottom : room.top) - center.y) / dy;
		const side: Side = toX <= toY ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
		const t = Math.min(toX, toY);
		const horizontal = side === 'top' || side === 'bottom';
		const [low, high] = horizontal ? [room.left, room.right] : [room.top, room.bottom];
		const ideal = Math.min(high, Math.max(low, horizontal ? center.x + dx * t : center.y + dy * t));
		const fixed = side === 'left' ? room.left : side === 'right' ? room.right : side === 'top' ? room.top : room.bottom;
		const at = (along: number): MapPoint => (horizontal ? { x: along, y: fixed } : { x: fixed, y: along });

		const obstacles = [...avoid, ...placed.map((marker) => boxOf(marker.x, marker.y))];
		const clear = (along: number): boolean => {
			const { x, y } = at(along);
			const box = boxOf(x, y);
			return obstacles.every((obstacle) => !intersects(box, obstacle));
		};
		// Just past either side of every obstacle is where a blocked marker can rest.
		const candidates = [ideal];
		for (const obstacle of obstacles) {
			const [start, end] = horizontal ? [obstacle.x, obstacle.x + obstacle.w] : [obstacle.y, obstacle.y + obstacle.h];
			candidates.push(start - half - GAP - 1, end + half + GAP + 1);
		}
		const spot = candidates.filter((along) => along >= low && along <= high && clear(along)).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
		// Nowhere on this edge is clear: the marker would only sit on something, so it is left out.
		if (spot === undefined) continue;
		const { x, y } = at(spot);
		placed.push({ ...input, x, y, angle: Math.atan2(dy, dx) });
	}
	return placed;
}
