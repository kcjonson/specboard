import { layoutMap } from './layout';
import { traceRegions, type RegionInput, type RegionOutline } from '../regions/outline';
import type { MapLayout, MapLayoutInput } from './types';

/**
 * The layout worker's messages. Each request carries an id the response echoes, so a
 * caller that sent a newer request can drop a stale answer.
 */
export interface MapLayoutRequest {
	id: number;
	input: MapLayoutInput;
}

/** Outlines at one grid step, which a zoom into a finer step asks for so the main thread never traces them mid-gesture. */
export interface MapOutlineRequest {
	id: number;
	trace: { inputs: readonly RegionInput[]; step: number };
}

export type MapLayoutResponse =
	| { id: number; ok: true; layout: MapLayout; ms: number }
	| { id: number; ok: false; error: string };

export type MapOutlineResponse =
	| { id: number; ok: true; outlines: RegionOutline[]; ms: number }
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

export function handleOutlineRequest(request: MapOutlineRequest, clock: () => number = Date.now): MapOutlineResponse {
	const start = clock();
	try {
		const outlines = traceRegions(request.trace.inputs, request.trace.step);
		return { id: request.id, ok: true, outlines, ms: clock() - start };
	} catch (error) {
		return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Whichever kind of request arrived. */
export function handleRequest(request: MapLayoutRequest | MapOutlineRequest, clock: () => number = Date.now): MapLayoutResponse | MapOutlineResponse {
	return 'trace' in request ? handleOutlineRequest(request, clock) : handleLayoutRequest(request, clock);
}

/**
 * The buffers a response's outlines hold. A big board's outlines are megabytes of points, and cloning them
 * into the main thread's heap blocked it for up to a second; handed over as transferables they cost nothing.
 */
export function transferablesOf(response: MapLayoutResponse | MapOutlineResponse): ArrayBuffer[] {
	if (!response.ok) return [];
	const sets = 'layout' in response ? response.layout.outlines.map((o) => o.regions) : [response.outlines];
	return sets.flatMap((regions) => regions.flatMap((outline) => [outline.loop.buffer as ArrayBuffer, outline.curve.buffer as ArrayBuffer]));
}
