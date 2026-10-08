import { usePolling } from '../hooks/usePolling';
import type { MapChangesModel } from './changes/changes-model';
import type { MapDataModel } from './map-data-model';

/**
 * How the Map learns that its projects changed: today the board's poll, which asks the
 * read and, on a project's own Map, the changes since the last visit to refresh together,
 * so the strip's count and the changes view keep up with the dots. The combined view has
 * no changes layer and polls less often (multi-project-view.md, decision 4). The Map
 * itself only consumes the models' change notifications, so when push lands (SPE-203) it
 * replaces this and nothing else. A failed first load is the Map's error state, with its
 * own Retry, and nothing polls behind it.
 */
export function useMapUpdates(model: MapDataModel, changes: MapChangesModel | null, interval: number): void {
	usePolling(async () => {
		const [read, since] = await Promise.all([model.refresh(), changes?.refresh() ?? true]);
		return read && since;
	}, () => model.state === 'error', interval);
}
