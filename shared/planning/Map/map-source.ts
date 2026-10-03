import { decodeMapRead, type MapReadWire } from '@specboard/core/map-read';
import { fetchClient } from '@specboard/fetch';
import type { MapReadSource } from './map-data-model';

/** The Map's whole-project read, decoded from its columnar wire form back into rows. */
export function createMapSource(projectRef: string): MapReadSource {
	return async () => decodeMapRead(await fetchClient.get<MapReadWire>(`/api/projects/${projectRef}/map`));
}
