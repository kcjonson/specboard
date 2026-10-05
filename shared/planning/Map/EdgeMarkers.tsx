import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { MARKER_SIZE, type EdgeMarker } from './edge-markers';
import type { OverlayStore } from './overlay';
import styles from './EdgeMarkers.module.css';

export interface EdgeMarkersProps {
	store: OverlayStore;
	/** The ruler's band along the bottom of the Map. */
	bottom: number;
	/** A marker was clicked: fly to what it points at. */
	onJump(key: string): void;
}

const sameMarkers = (a: readonly EdgeMarker[], b: readonly EdgeMarker[]): boolean =>
	a.length === b.length && a.every((m, i) => m.key === b[i]!.key && m.kind === b[i]!.kind && m.count === b[i]!.count && m.x === b[i]!.x && m.y === b[i]!.y && m.angle === b[i]!.angle);

const labelOf = (marker: EdgeMarker): string =>
	marker.count > 1 ? `${marker.label}, and ${marker.count - 1} more off screen` : `${marker.label}, off screen`;

/**
 * The marks at the plot's edge that point toward what the view doesn't show: live sessions,
 * and items that need a person. The surface places them every frame; they are real buttons,
 * so each is a tab stop that flies to its target. A pan moves them, a still view holds
 * them, and nothing about them animates.
 */
export function EdgeMarkers({ store, bottom, onJump }: EdgeMarkersProps): JSX.Element {
	const [markers, setMarkers] = useState<readonly EdgeMarker[]>(store.frame.markers);
	useEffect(() => {
		setMarkers(store.frame.markers);
		return store.subscribe(({ markers: next }) => setMarkers((previous) => (sameMarkers(previous, next) ? previous : next)));
	}, [store]);
	return (
		<div class={styles.layer} style={{ bottom: `${bottom}px` }}>
			{markers.map((marker) => (
				<button
					key={`${marker.kind}:${marker.key}`}
					type="button"
					class={styles.marker}
					data-kind={marker.kind}
					aria-label={labelOf(marker)}
					style={{ width: `${MARKER_SIZE}px`, height: `${MARKER_SIZE}px`, transform: `translate(${Math.round(marker.x - MARKER_SIZE / 2)}px, ${Math.round(marker.y - MARKER_SIZE / 2)}px)` }}
					onClick={() => onJump(marker.key)}
				>
					<svg class={styles.arrow} width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" style={{ transform: `rotate(${marker.angle}rad)` }}>
						<path d="M-4 -5 L5 0 L-4 5 Z" fill="currentColor" />
					</svg>
					{marker.count > 1 && <span class={styles.count} aria-hidden="true">{marker.count}</span>}
				</button>
			))}
		</div>
	);
}
