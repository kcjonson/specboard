import { usePolling } from '../hooks/usePolling';
import type { MapChangesModel } from './changes/changes-model';
import type { MapDataModel } from './map-data-model';

/**
 * How the Map learns that the project changed: today the board's poll, which asks the
 * read and the changes since the last visit to refresh together, so the strip's count and
 * the changes view keep up with the dots. The Map itself only consumes the models' change
 * notifications, so when push lands (SPE-203) it replaces this and nothing else. A failed
 * first load is the Map's error state, with its own Retry, and nothing polls behind it.
 */
export function useMapUpdates(model: MapDataModel, changes: MapChangesModel): void {
	usePolling(async () => {
		const [read, since] = await Promise.all([model.refresh(), changes.refresh()]);
		return read && since;
	}, () => model.state === 'error');
}
