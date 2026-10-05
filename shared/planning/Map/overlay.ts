import type { MapItemRow } from '@specboard/core/map-read';
import type { Box } from './box-index';
import type { Transform } from './camera';
import type { DrawDot, Rollup } from './draw-list';
import type { MapBounds, MapPoint } from './layout/types';
import type { MinimapSize } from './minimap/minimap';
import type { EdgeMarker } from './edge-markers';
import type { AgentCard, QuickSession } from './quick/agent-content';
import type { QuickSide } from './quick/quick-card-placement';
import type { Relation } from './relations';

/**
 * What the Map draws as DOM over its canvas: the near level's cards and the minimap.
 * The surface publishes a frame with every repaint, and the components that draw
 * from it subscribe, so a pan moves two elements and re-renders nothing unless the
 * set of cards in view changed.
 */

/** The dots that carry a card; the same object for as long as the set and the scale hold. */
export interface CardSet {
	dots: readonly DrawDot[];
	keys: ReadonlySet<string>;
	/** Cards are placed at this scale, so a zoom is a new set even when the same dots are in view. */
	k: number;
}

export interface MinimapFrame {
	/** Where the panel sits in the plot, which labels keep off. */
	panel: Box;
	size: MinimapSize;
	bounds: MapBounds;
	/** What the plot shows, in the miniature's pixels, cut to the miniature: for drawing only. */
	viewport: Box;
	/** The layout point in the middle of the plot and how much of the Map the plot covers, whole even where the Map's edge cuts the rectangle: what the keys move by. */
	center: MapPoint;
	span: { width: number; height: number };
	dots: readonly DrawDot[];
}

/**
 * The quick card's subject and where it opens, in plot pixels: an item (with the sessions
 * on it, and its family's progress when it has children), or a session or computer, whose
 * card is `agent`.
 */
export interface QuickFrame {
	key: string;
	x: number;
	y: number;
	side: QuickSide;
	/** The family's items by phase when the item has children. */
	progress: Rollup | null;
	sessions: QuickSession[];
	agent: AgentCard | null;
}

/** A dot being dragged and how far it is from home, in layout units. */
export interface DragOffset {
	key: string;
	dx: number;
	dy: number;
}

export interface OverlayFrame {
	transform: Transform;
	rows: ReadonlyMap<string, MapItemRow>;
	/** The cards to mount, or null when the level has none. */
	cards: CardSet | null;
	/** 0 to 1 while cards fade with a level switch. */
	cardAlpha: number;
	/** Null until the camera is zoomed in past fit all. */
	minimap: MinimapFrame | null;
	/** Null while no card is open. */
	quick: QuickFrame | null;
	/** Marks at the plot's edge pointing toward live sessions and items that need a person outside the view. */
	markers: readonly EdgeMarker[];
	/** What hover, focus, or selection lights, which fades the cards outside it; null when nothing does. */
	focus: Relation | null;
	/** The card of a dragged dot moves with it. */
	drag: DragOffset | null;
}

export interface MapOverlay {
	publish(frame: OverlayFrame): void;
}

export const EMPTY_OVERLAY: OverlayFrame = { transform: { k: 1, x: 0, y: 0 }, rows: new Map(), cards: null, cardAlpha: 0, minimap: null, quick: null, markers: [], focus: null, drag: null };

export class OverlayStore implements MapOverlay {
	frame: OverlayFrame = EMPTY_OVERLAY;
	private readonly listeners = new Set<(frame: OverlayFrame) => void>();

	publish(frame: OverlayFrame): void {
		this.frame = frame;
		for (const listener of [...this.listeners]) listener(frame);
	}

	subscribe(listener: (frame: OverlayFrame) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
