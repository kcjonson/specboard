import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { EDGE_MARKER_SIZE, type EdgeMarkerKind, type PlacedEdgeMarker } from './edge-markers';
import type { OverlayStore } from './overlay';
import styles from './EdgeMarkers.module.css';

export interface EdgeMarkersProps {
	store: OverlayStore;
	/** The ruler's band along the bottom of the Map, which markers stay off. */
	bottom: number;
	/** A marker was clicked: fly to its item. */
	onJump(key: string): void;
}

const KIND_LABELS: Record<EdgeMarkerKind, string> = { 'up-next': 'Up next', 'needs-person': 'Needs a person', live: 'Live session' };
const KIND_CLASSES: Record<EdgeMarkerKind, string> = { 'up-next': styles.upNext!, 'needs-person': styles.needsPerson!, live: styles.live! };

/** Which way an angle points, in words, for the marker's name. */
function direction(angle: number): string {
	if (Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))) return Math.cos(angle) > 0 ? 'right' : 'left';
	return Math.sin(angle) > 0 ? 'below' : 'above';
}

/**
 * The markers at the plot's edge for items out of view (see edge-markers.ts). They are
 * buttons, since the point of one is to go there; the surface decides which exist and where,
 * once per repaint, and this only draws them.
 */
export function EdgeMarkers({ store, bottom, onJump }: EdgeMarkersProps): JSX.Element {
	const [markers, setMarkers] = useState<readonly PlacedEdgeMarker[]>(store.frame.edges);
	useEffect(() => {
		setMarkers(store.frame.edges);
		return store.subscribe(({ edges }) => setMarkers((previous) => (sameMarkers(previous, edges) ? previous : edges)));
	}, [store]);

	return (
		<div class={styles.layer} style={{ bottom: `${bottom}px` }}>
			{markers.map((marker) => (
				<button
					key={`${marker.kind}:${marker.key}`}
					type="button"
					class={`${styles.marker} ${KIND_CLASSES[marker.kind]}`}
					style={{ left: `${marker.x - EDGE_MARKER_SIZE / 2}px`, top: `${marker.y - EDGE_MARKER_SIZE / 2}px`, width: `${EDGE_MARKER_SIZE}px`, height: `${EDGE_MARKER_SIZE}px` }}
					aria-label={`${KIND_LABELS[marker.kind]}${marker.text ? ` ${marker.text}` : ''}: ${marker.key}, off screen ${direction(marker.angle)}`}
					onClick={() => onJump(marker.key)}
				>
					<span class={styles.text} aria-hidden="true">{marker.text ?? ''}</span>
					<span class={styles.arrow} style={{ transform: `rotate(${marker.angle}rad)` }} aria-hidden="true" />
				</button>
			))}
		</div>
	);
}

function sameMarkers(a: readonly PlacedEdgeMarker[], b: readonly PlacedEdgeMarker[]): boolean {
	return a.length === b.length && a.every((m, i) => m.key === b[i]!.key && m.kind === b[i]!.kind && m.text === b[i]!.text && m.x === b[i]!.x && m.y === b[i]!.y && m.angle === b[i]!.angle);
}
