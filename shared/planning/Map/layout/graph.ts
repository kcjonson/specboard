export type Edge = readonly [from: number, to: number];

function adjacency(n: number, edges: readonly Edge[]): { start: Int32Array; list: Int32Array } {
	const start = new Int32Array(n + 1);
	for (const [from] of edges) start[from + 1]!++;
	for (let i = 0; i < n; i++) start[i + 1]! += start[i]!;
	const fill = start.slice(0, n);
	const list = new Int32Array(edges.length);
	for (const [from, to] of edges) list[fill[from]!++] = to;
	return { start, list };
}

/**
 * Strongly connected components (Tarjan's algorithm, iterative so a long chain can't
 * overflow the stack). Returns each vertex's component id and each component's size.
 */
export function stronglyConnected(n: number, edges: readonly Edge[]): { component: Int32Array; size: Int32Array } {
	const { start, list } = adjacency(n, edges);
	const index = new Int32Array(n).fill(-1);
	const low = new Int32Array(n);
	const onStack = new Uint8Array(n);
	const next = new Int32Array(n);
	const component = new Int32Array(n).fill(-1);
	const sizes: number[] = [];
	const stack: number[] = [];
	const calls: number[] = [];
	let counter = 0;

	const visit = (v: number): void => {
		index[v] = low[v] = counter++;
		stack.push(v);
		onStack[v] = 1;
		next[v] = start[v]!;
		calls.push(v);
	};

	for (let s = 0; s < n; s++) {
		if (index[s] !== -1) continue;
		visit(s);
		while (calls.length) {
			const v = calls[calls.length - 1]!;
			if (next[v]! < start[v + 1]!) {
				const w = list[next[v]!++]!;
				if (index[w] === -1) visit(w);
				else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
				continue;
			}
			calls.pop();
			if (calls.length) {
				const u = calls[calls.length - 1]!;
				low[u] = Math.min(low[u]!, low[v]!);
			}
			if (low[v] === index[v]) {
				const id = sizes.length;
				let size = 0;
				let w: number;
				do {
					w = stack.pop()!;
					onStack[w] = 0;
					component[w] = id;
					size++;
				} while (w !== v);
				sizes.push(size);
			}
		}
	}
	return { component, size: Int32Array.from(sizes) };
}

/** Topological order of an acyclic graph (Kahn's algorithm, ties broken by index). */
export function topologicalOrder(n: number, edges: readonly Edge[]): number[] {
	const { start, list } = adjacency(n, edges);
	const indegree = new Int32Array(n);
	for (const [, to] of edges) indegree[to]!++;
	const order: number[] = [];
	for (let v = 0; v < n; v++) if (indegree[v] === 0) order.push(v);
	for (let head = 0; head < order.length; head++) {
		const v = order[head]!;
		for (let e = start[v]!; e < start[v + 1]!; e++) {
			const w = list[e]!;
			if (--indegree[w]! === 0) order.push(w);
		}
	}
	return order;
}
