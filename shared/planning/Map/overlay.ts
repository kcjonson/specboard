import type { MapItemRow } from '@specboard/core/map-read';
import type { Box } from './box-index';
import type { Transform } from './camera';
import type { DrawDot } from './draw-list';
import type { MapBounds } from './layout/types';
import type { MinimapSize } from './minimap/minimap';

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
	/** What the plot shows, in the miniature's pixels. */
	viewport: Box;
	dots: readonly DrawDot[];
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
}

export interface MapOverlay {
	publish(frame: OverlayFrame): void;
}

export const EMPTY_OVERLAY: OverlayFrame = { transform: { k: 1, x: 0, y: 0 }, rows: new Map(), cards: null, cardAlpha: 0, minimap: null };

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
