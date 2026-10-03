import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { buildDrawList } from './draw-list';

describe('draw list', () => {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const child = b.add({ parentKey: epic.key, status: 'ready' });
	const sibling = b.add({ parentKey: epic.key, status: 'done' });
	const blocker = b.add({ status: 'in_progress' });
	const waiting = b.add({ status: 'ready' });
	b.block(waiting, blocker);
	b.work(blocker, 'session-a', 'laptop');
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	const list = buildDrawList(layout, rows);
	const byKey = new Map(list.map((dot) => [dot.key, dot]));

	it('draws nothing for a parent with visible children, which is a region', () => {
		expect(byKey.has(epic.key)).toBe(false);
		expect(byKey.has(child.key)).toBe(true);
		expect(byKey.has(sibling.key)).toBe(true);
	});

	it('draws nothing for computers and sessions', () => {
		expect(layout.nodes.some((node) => node.kind !== 'item')).toBe(true);
		expect(list).toHaveLength(4);
	});

	it('shows Blocked on an item with an open blocker, whatever its status', () => {
		expect(byKey.get(waiting.key)!.status).toBe('blocked');
		expect(byKey.get(child.key)!.status).toBe('ready');
	});

	it('copies each dot from its node, in layout units', () => {
		const node = layout.nodes.find((n) => n.key === child.key)!;
		expect(byKey.get(child.key)).toMatchObject({ x: node.x, y: node.y, r: node.r });
	});

	it('puts in-flight work after what it overlaps', () => {
		const order = list.map((dot) => dot.status);
		expect(order.lastIndexOf('done')).toBeLessThan(order.indexOf('in_progress'));
	});

	it('skips a node whose row is missing rather than guessing a status', () => {
		expect(buildDrawList(layout, new Map())).toEqual([]);
	});
});
