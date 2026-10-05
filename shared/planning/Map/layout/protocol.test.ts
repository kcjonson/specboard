import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardBuilder, NOW } from './board-fixture';
import { handleLayoutRequest, handleOutlineRequest, handleRequest, transferablesOf, type MapLayoutRequest, type MapLayoutResponse, type MapOutlineRequest } from './protocol';

function request(id: number): MapLayoutRequest {
	const b = new BoardBuilder();
	for (let i = 0; i < 5; i++) b.add({ status: i % 2 ? 'done' : 'ready' });
	return { id, input: { rows: b.rows, now: NOW, collapse: {}, aspect: 2 } };
}

describe('handleLayoutRequest', () => {
	it('answers with the layout and the id it was asked with', () => {
		let t = 0;
		const response = handleLayoutRequest(request(7), () => (t += 5));
		expect(response).toMatchObject({ id: 7, ok: true, ms: 5 });
		expect(response.ok && response.layout.nodes).toHaveLength(5);
	});

	it('reports a failure instead of throwing', () => {
		const bad = { id: 3, input: { rows: null, now: NOW, collapse: {}, aspect: 2 } } as unknown as MapLayoutRequest;
		const response = handleLayoutRequest(bad);
		expect(response.id).toBe(3);
		expect(response.ok).toBe(false);
	});
});

describe('handleOutlineRequest', () => {
	const members = [[0, 0], [30, 10], [60, 0]].map(([x, y]) => ({ x: x!, y: y!, r: 5.5 }));
	const trace: MapOutlineRequest = { id: 4, trace: { inputs: [{ key: 'A', parentKey: null, height: 1, members }], step: 5 } };

	it('traces the outlines at the step it was asked for, under the id it was asked with', () => {
		const response = handleOutlineRequest(trace, () => 1);
		expect(response).toMatchObject({ id: 4, ok: true });
		expect(response.ok && response.outlines.map((o) => o.key)).toEqual(['A']);
	});

	it('is told apart from a layout request by what it carries', () => {
		expect(handleRequest(trace)).toMatchObject({ id: 4, ok: true, outlines: expect.any(Array) });
		expect(handleRequest(request(5))).toMatchObject({ id: 5, ok: true, layout: expect.any(Object) });
	});

	it('reports a failure instead of throwing', () => {
		const bad = { id: 6, trace: { inputs: null, step: 5 } } as unknown as MapOutlineRequest;
		expect(handleOutlineRequest(bad)).toMatchObject({ id: 6, ok: false });
	});
});

describe('transferablesOf', () => {
	it('lists the buffers of every outline a response carries, a layout\'s or a trace\'s, and nothing for a failure', () => {
		const members = [{ x: 0, y: 0, r: 5.5 }, { x: 40, y: 0, r: 5.5 }];
		const traced = handleOutlineRequest({ id: 1, trace: { inputs: [{ key: 'A', parentKey: null, height: 1, members }], step: 5 } });
		const buffers = transferablesOf(traced);
		expect(buffers).toHaveLength(2);
		expect(new Set(buffers).size).toBe(2);

		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		for (let i = 0; i < 3; i++) b.add({ parentKey: epic.key, status: 'ready' });
		const laid = handleLayoutRequest({ id: 2, input: { rows: b.rows, now: NOW, collapse: {}, aspect: 2, outlineSteps: [5, 2.5] } });
		expect(transferablesOf(laid)).toHaveLength(4);
		expect(transferablesOf({ id: 3, ok: false, error: 'x' })).toEqual([]);
	});
});

describe('layout.worker', () => {
	const scope = globalThis as unknown as {
		onmessage?: ((event: { data: MapLayoutRequest }) => void) | null;
		postMessage?: (message: MapLayoutResponse, transfer: ArrayBuffer[]) => void;
	};

	afterEach(() => {
		delete scope.onmessage;
		delete scope.postMessage;
	});

	it('runs without a DOM and answers each message', async () => {
		const posted = vi.fn();
		scope.postMessage = posted;
		await import('./layout.worker');
		scope.onmessage!({ data: request(11) });
		expect(posted).toHaveBeenCalledTimes(1);
		expect(posted.mock.calls[0]![0]).toMatchObject({ id: 11, ok: true });
		expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
	});
});
