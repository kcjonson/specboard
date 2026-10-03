import type { MapLayoutRequest, MapLayoutResponse } from './protocol';
import type { MapLayout, MapLayoutInput } from './types';

export interface MapLayoutWorker {
	/** Resolves with the layout and how long the worker spent on it, in ms. */
	layout(input: MapLayoutInput): Promise<{ layout: MapLayout; ms: number }>;
	terminate(): void;
}

/** Starts the layout in a module worker, off the main thread. */
export function createLayoutWorker(): MapLayoutWorker {
	const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve: (value: { layout: MapLayout; ms: number }) => void; reject: (error: Error) => void }>();
	let nextId = 1;

	const failAll = (error: Error): void => {
		for (const { reject } of pending.values()) reject(error);
		pending.clear();
	};
	worker.onmessage = (event: { data: MapLayoutResponse }): void => {
		const response = event.data;
		const waiter = pending.get(response.id);
		if (!waiter) return;
		pending.delete(response.id);
		if (response.ok) waiter.resolve({ layout: response.layout, ms: response.ms });
		else waiter.reject(new Error(response.error));
	};
	worker.onerror = (event: { message: string }): void => failAll(new Error(event.message || 'Map layout worker failed'));

	return {
		layout(input) {
			const request: MapLayoutRequest = { id: nextId++, input };
			return new Promise((resolve, reject) => {
				pending.set(request.id, { resolve, reject });
				worker.postMessage(request);
			});
		},
		terminate() {
			worker.terminate();
			failAll(new Error('Map layout worker terminated'));
		},
	};
}
