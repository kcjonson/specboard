import { describe, expect, it } from 'vitest';
import { stronglyConnected, topologicalOrder } from './graph';

describe('stronglyConnected', () => {
	it('groups a cycle and leaves the rest alone', () => {
		// 0 -> 1 -> 2 -> 0 is a cycle; 3 hangs off it; 4 is isolated.
		const { component, size } = stronglyConnected(5, [
			[0, 1],
			[1, 2],
			[2, 0],
			[2, 3],
		]);
		expect(component[0]).toBe(component[1]);
		expect(component[1]).toBe(component[2]);
		expect(size[component[0]!]).toBe(3);
		expect(size[component[3]!]).toBe(1);
		expect(size[component[4]!]).toBe(1);
		expect(component[3]).not.toBe(component[0]);
	});

	it('handles a long chain without recursing', () => {
		const n = 50_000;
		const edges = Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as const);
		const { size } = stronglyConnected(n, edges);
		expect(size.length).toBe(n);
	});
});

describe('topologicalOrder', () => {
	it('puts every vertex after what points at it', () => {
		const edges = [
			[3, 1],
			[1, 0],
			[2, 0],
		] as const;
		const order = topologicalOrder(4, edges);
		const at = new Map(order.map((v, i) => [v, i]));
		for (const [from, to] of edges) expect(at.get(from)!).toBeLessThan(at.get(to)!);
		expect(order).toHaveLength(4);
	});
});
