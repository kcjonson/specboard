import type { MapItemRow, MapItemStatus } from '@specboard/core/map-read';
import { glyphStatus } from '@specboard/ui';
import type { Dot } from './camera';
import type { MapLayout } from './layout/types';

/** One glyph for the renderer, in layout units. The renderer knows nothing of rows, layouts, or the model. */
export interface DrawDot extends Dot {
	status: MapItemStatus;
}

/** In flight work draws on top of what it overlaps. */
const LAYER: Record<MapItemStatus, number> = { done: 0, blocked: 1, ready: 1, in_review: 2, in_progress: 2 };

/**
 * The dots the layout placed, with the status each one's glyph shows. A parent with
 * visible children (a hub) is a region, which a later task draws, so it draws nothing
 * here; computers and sessions are dots of a later task too.
 */
export function buildDrawList(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>): DrawDot[] {
	const dots: DrawDot[] = [];
	for (const node of layout.nodes) {
		if (node.kind !== 'item' || node.hub) continue;
		const row = rows.get(node.key);
		if (!row) continue;
		dots.push({ key: node.key, x: node.x, y: node.y, r: node.r, status: glyphStatus(row.status, row.blocked) });
	}
	return dots.sort((a, b) => LAYER[a.status] - LAYER[b.status]);
}
