import type { RegionInput, RegionOutline } from '../regions/outline';
import type { MapLayoutRequest, MapLayoutResponse, MapOutlineRequest, MapOutlineResponse } from './protocol';
import type { MapLayout, MapLayoutInput } from './types';

export interface MapLayoutWorker {
	/** Resolves with the layout and how long the worker spent on it, in ms. */
	layout(input: MapLayoutInput): Promise<{ layout: MapLayout; ms: number }>;
	/** Traces region outlines at one grid step off the main thread. */
	outlines(inputs: readonly RegionInput[], step: number): Promise<RegionOutline[]>;
	terminate(): void;
}

/** Starts the layout in a module worker, off the main thread. */
export function createLayoutWorker(): MapLayoutWorker {
	const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve: (response: MapLayoutResponse | MapOutlineResponse) => void; reject: (error: Error) => void }>();
	let nextId = 1;
	// Once terminated or crashed the worker never answers, so later requests fail at once.
	let dead: Error | null = null;

	const fail = (error: Error): void => {
		dead ??= error;
		for (const { reject } of pending.values()) reject(dead);
		pending.clear();
	};
	worker.onmessage = (event: { data: MapLayoutResponse | MapOutlineResponse }): void => {
		const response = event.data;
		const waiter = pending.get(response.id);
		if (!waiter) return;
		pending.delete(response.id);
		if (response.ok) waiter.resolve(response);
		else waiter.reject(new Error(response.error));
	};
	worker.onerror = (event: { message: string }): void => fail(new Error(event.message || 'Map layout worker failed'));

	const ask = (build: (id: number) => MapLayoutRequest | MapOutlineRequest): Promise<MapLayoutResponse | MapOutlineResponse> => {
		if (dead) return Promise.reject(dead);
		const request = build(nextId++);
		return new Promise((resolve, reject) => {
			pending.set(request.id, { resolve, reject });
			worker.postMessage(request);
		});
	};

	return {
		async layout(input) {
			const response = (await ask((id) => ({ id, input }))) as Extract<MapLayoutResponse, { ok: true }>;
			return { layout: response.layout, ms: response.ms };
		},
		async outlines(inputs, step) {
			const response = (await ask((id) => ({ id, trace: { inputs, step } }))) as Extract<MapOutlineResponse, { ok: true }>;
			return response.outlines;
		},
		terminate() {
			worker.terminate();
			fail(new Error('Map layout worker terminated'));
		},
	};
}
