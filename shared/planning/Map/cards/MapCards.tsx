import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { MapItemRow } from '@specboard/core/map-read';
import type { OverlayFrame, OverlayStore } from '../overlay';
import { MapCard } from './MapCard';
import styles from './MapCards.module.css';

interface Mounted {
	cards: OverlayFrame['cards'];
	rows: ReadonlyMap<string, MapItemRow>;
}

export interface MapCardsProps {
	store: OverlayStore;
	/** The ruler's band along the bottom of the Map, which cards stay off. */
	bottom: number;
}

/**
 * The near level's cards, over the canvas. Positions are at the camera's scale and the
 * whole layer is translated by its pan, so a pan is one style write on one element; the
 * cards re-render only when the set in view or the scale changes, and the camera's frame
 * fades the layer with a level switch.
 */
export function MapCards({ store, bottom }: MapCardsProps): JSX.Element {
	const layer = useRef<HTMLUListElement>(null);
	const [mounted, setMounted] = useState<Mounted>({ cards: store.frame.cards, rows: store.frame.rows });

	useEffect(() => {
		const apply = ({ transform, cards, rows, cardAlpha }: OverlayFrame): void => {
			const el = layer.current!;
			// Whole pixels keep the text crisp; the canvas under it is drawn at the exact offset.
			el.style.transform = `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px)`;
			el.style.opacity = String(cardAlpha);
			setMounted((previous) => (previous.cards === cards && previous.rows === rows ? previous : { cards, rows }));
		};
		apply(store.frame);
		return store.subscribe(apply);
	}, [store]);

	const { cards, rows } = mounted;
	return (
		<div class={styles.cards} style={{ bottom: `${bottom}px` }}>
			<ul class={styles.layer} ref={layer} aria-label="Items in view">
				{cards?.dots.map((dot) => {
					const row = rows.get(dot.key);
					return row ? <MapCard key={dot.key} row={row} dot={dot} k={cards.k} /> : null;
				})}
			</ul>
		</div>
	);
}
