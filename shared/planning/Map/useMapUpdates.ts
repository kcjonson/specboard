import { usePolling } from '../hooks/usePolling';
import type { MapDataModel } from './map-data-model';

/**
 * How the Map learns that the project changed: today the board's poll, which asks the
 * model to refresh. The Map itself only consumes the model's change notifications, so
 * when push lands (SPE-203) it replaces this and nothing else. A failed first load is the
 * Map's error state, with its own Retry, and nothing polls behind it.
 */
export function useMapUpdates(model: MapDataModel): void {
	usePolling(() => model.refresh(), () => model.state === 'error');
}
