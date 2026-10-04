import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { MapItemRow } from '@specboard/core/map-read';
import type { OverlayFrame, OverlayStore } from '../overlay';
import { MapCard } from './MapCard';
import styles from './MapCards.module.css';

interface Mounted {
	cards: OverlayFrame['cards'];
	rows: ReadonlyMap<string, MapItemRow>;
	focus: OverlayFrame['focus'];
}

export interface MapCardsProps {
	store: OverlayStore;
	/** The ruler's band along the bottom of the Map, which cards stay off. */
	bottom: number;
}

/**
 * The near level's cards, over the canvas. Positions are at the camera's scale and the
 * whole layer is translated by its pan, so a pan is one style write on one element; the
 * cards re-render only when the set in view, the scale, or what is lit changes, and the
 * camera's frame fades the layer with a level switch. A dragged dot's card is moved by its
 * own `translate`, a property apart from the card's position.
 */
export function MapCards({ store, bottom }: MapCardsProps): JSX.Element {
	const layer = useRef<HTMLUListElement>(null);
	const dragged = useRef<HTMLElement | null>(null);
	const latest = useRef(store.frame);
	const [mounted, setMounted] = useState<Mounted>({ cards: store.frame.cards, rows: store.frame.rows, focus: store.frame.focus });

	// A dragged dot's card moves by its own `translate`, set straight on the element: a drag is a frame-by-frame thing.
	const pull = (): void => {
		const { transform, drag } = latest.current;
		if (dragged.current && (dragged.current.dataset.key !== drag?.key || !dragged.current.isConnected)) {
			dragged.current.style.translate = '';
			dragged.current = null;
		}
		if (!drag) return;
		dragged.current ??= Array.from(layer.current!.children).find((child): child is HTMLElement => (child as HTMLElement).dataset.key === drag.key) ?? null;
		if (dragged.current) dragged.current.style.translate = `${drag.dx * transform.k}px ${drag.dy * transform.k}px`;
	};
	// Cards that mount while a drag is under way (the dragged dot's own, on the first frame) are found after the render.
	useEffect(pull);

	useEffect(() => {
		const apply = (frame: OverlayFrame): void => {
			const { transform, cards, rows, cardAlpha, focus } = frame;
			latest.current = frame;
			const el = layer.current!;
			// Whole pixels keep the text crisp; the canvas under it is drawn at the exact offset.
			el.style.transform = `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px)`;
			el.style.opacity = String(cardAlpha);
			pull();
			setMounted((previous) => (previous.cards === cards && previous.rows === rows && previous.focus === focus ? previous : { cards, rows, focus }));
		};
		apply(store.frame);
		return store.subscribe(apply);
	}, [store]);

	const { cards, rows, focus } = mounted;
	return (
		<div class={styles.cards} style={{ bottom: `${bottom}px` }}>
			<ul class={styles.layer} ref={layer} aria-label="Items in view">
				{cards?.dots.map((dot) => {
					const row = rows.get(dot.key);
					const faded = focus !== null && !focus.dots.has(dot.key);
					const lit = focus !== null && !focus.region && focus.key === dot.key;
					return row ? <MapCard key={dot.key} row={row} dot={dot} k={cards.k} faded={faded} lit={lit} /> : null;
				})}
			</ul>
		</div>
	);
}
