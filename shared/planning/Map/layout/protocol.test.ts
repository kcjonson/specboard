import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardBuilder, NOW } from './board-fixture';
import { handleLayoutRequest, type MapLayoutRequest, type MapLayoutResponse } from './protocol';

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

describe('layout.worker', () => {
	const scope = globalThis as unknown as {
		onmessage?: ((event: { data: MapLayoutRequest }) => void) | null;
		postMessage?: (message: MapLayoutResponse) => void;
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
