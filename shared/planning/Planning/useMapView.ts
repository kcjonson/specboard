import { useCallback, useEffect, useState } from 'preact/hooks';

type MapViewComponent = typeof import('../Map/MapView').MapView;

let loaded: MapViewComponent | undefined;

/**
 * The Map's code, loaded the first time the view opens so Board and Table don't carry
 * it (spec, Performance). Once in, it stays: leaving the Map and coming back doesn't
 * wait on the network again. A failed load is an error to retry, not a blank view.
 */
export function useMapView(wanted: boolean): { MapView: MapViewComponent | undefined; error: Error | null; retry: () => void } {
	const [MapView, setMapView] = useState<MapViewComponent | undefined>(() => loaded);
	const [error, setError] = useState<Error | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!wanted || MapView) return;
		let current = true;
		setError(null);
		import('../Map/MapView').then(
			(module) => {
				loaded = module.MapView;
				if (current) setMapView(() => module.MapView);
			},
			(failure: unknown) => {
				if (current) setError(failure instanceof Error ? failure : new Error(String(failure)));
			},
		);
		return () => {
			current = false;
		};
	}, [wanted, MapView, attempt]);

	const retry = useCallback((): void => setAttempt((n) => n + 1), []);
	return { MapView, error, retry };
}
