import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW } from './board-fixture';
import { createLayoutWorker } from './layout-worker-client';
import { handleLayoutRequest, type MapLayoutRequest, type MapLayoutResponse } from './protocol';
import type { MapLayoutInput } from './types';

/** Stands in for the browser's Worker, answering through the real handler. */
class FakeWorker {
	static last: FakeWorker;
	onmessage: ((event: { data: MapLayoutResponse }) => void) | null = null;
	onerror: ((event: { message: string }) => void) | null = null;
	posted: MapLayoutRequest[] = [];
	terminated = false;

	constructor() {
		FakeWorker.last = this;
	}

	postMessage(request: MapLayoutRequest): void {
		this.posted.push(request);
	}

	answer(): void {
		for (const request of this.posted.splice(0)) this.onmessage?.({ data: handleLayoutRequest(request) });
	}

	terminate(): void {
		this.terminated = true;
	}
}

const input: MapLayoutInput = { rows: [], now: NOW, collapse: {}, aspect: 2 };
const scope = globalThis as unknown as { Worker?: unknown };
let original: unknown;

beforeEach(() => {
	original = scope.Worker;
	scope.Worker = FakeWorker;
});

afterEach(() => {
	scope.Worker = original;
});

describe('createLayoutWorker', () => {
	it('resolves each request with its own answer', async () => {
		const client = createLayoutWorker();
		const first = client.layout(input);
		const second = client.layout({ ...input, now: NOW + 1 });
		FakeWorker.last.answer();
		await expect(first).resolves.toMatchObject({ layout: { nodes: [] } });
		await expect(second).resolves.toMatchObject({ layout: { nodes: [] } });
	});

	it('rejects what was pending and everything after, once terminated', async () => {
		const client = createLayoutWorker();
		const pending = client.layout(input);
		client.terminate();
		expect(FakeWorker.last.terminated).toBe(true);
		await expect(pending).rejects.toThrow('terminated');
		await expect(client.layout(input)).rejects.toThrow('terminated');
		expect(FakeWorker.last.posted).toHaveLength(1);
	});

	it('rejects everything after the worker fails', async () => {
		const client = createLayoutWorker();
		const pending = client.layout(input);
		FakeWorker.last.onerror?.({ message: 'boom' });
		await expect(pending).rejects.toThrow('boom');
		await expect(client.layout(input)).rejects.toThrow('boom');
	});
});
