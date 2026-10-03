import type { MapReadSource } from './map-data-model';

/** The Map's read for one project. */
export function createMapSource(projectRef: string): MapReadSource {
	return () => Promise.reject(new Error(`The Map's read endpoint is not wired for ${projectRef}`));
}
