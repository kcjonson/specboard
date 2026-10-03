import { layoutMap } from './layout';
import type { MapLayout, MapLayoutInput } from './types';

/**
 * The layout worker's messages. Each request carries an id the response echoes, so a
 * caller that sent a newer request can drop a stale answer.
 */
export interface MapLayoutRequest {
	id: number;
	input: MapLayoutInput;
}

export type MapLayoutResponse =
	| { id: number; ok: true; layout: MapLayout; ms: number }
	| { id: number; ok: false; error: string };

export function handleLayoutRequest(request: MapLayoutRequest, clock: () => number = Date.now): MapLayoutResponse {
	const start = clock();
	try {
		const layout = layoutMap(request.input);
		return { id: request.id, ok: true, layout, ms: clock() - start };
	} catch (error) {
		return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
