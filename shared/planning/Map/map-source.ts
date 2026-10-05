import { decodeMapRead, type MapReadWire } from '@specboard/core/map-read';
import { fetchClient } from '@specboard/fetch';
import type { MapReadSource } from './map-data-model';

/** The Map's project read, decoded from its columnar wire form back into rows: the whole project, or what changed since a cursor. */
export function createMapSource(projectRef: string): MapReadSource {
	return async (since) => decodeMapRead(await fetchClient.get<MapReadWire>(`/api/projects/${projectRef}/map${since === null ? '' : `?since=${since}`}`));
}
