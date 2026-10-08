import type { JSX } from 'preact';
import type { MapViewProps } from '../Map/MapView';
import { LoadError } from '../LoadError/LoadError';
import { useMapView } from './useMapView';
import styles from './LazyMap.module.css';

/**
 * The Map in a planning view, one project's or several projects': loading while its code
 * is on the way, a failed load to retry, then the Map. The Map makes reads of its own, so
 * the lists' loading and errors say nothing about it.
 */
export function LazyMap(props: MapViewProps): JSX.Element {
	const { MapView, error, retry } = useMapView();
	if (error) return <LoadError error={error} onRetry={retry} />;
	if (!MapView) return <div class={styles.loading}>Loading...</div>;
	return <MapView {...props} />;
}
