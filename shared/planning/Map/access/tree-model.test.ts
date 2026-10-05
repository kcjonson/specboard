import { describe, expect, it } from 'vitest';
import { agentsOf } from '../agents';
import { BoardBuilder, iso } from '../layout/board-fixture';
import { layoutMap } from '../layout/layout';
import { mapFacts } from '../map-facts';
import { activeNode, buildTree, type MapTree, type TreeNode } from './tree-model';

const DAY = 86_400_000;

function treeOf(build: (b: BoardBuilder) => void, collapse: Record<string, boolean> = {}): { tree: MapTree; b: BoardBuilder; layout: ReturnType<typeof layoutMap> } {
	const b = new BoardBuilder();
	build(b);
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse, aspect: 2 });
	const facts = mapFacts(layout, rows, b.now);
	const working = agentsOf(layout, rows, b.now);
	const tree = buildTree({ layout, rows, needs: facts.needs, liveItems: facts.liveItems, working, now: b.now, idPrefix: 'tree', summarized: false });
	return { tree, b, layout };
}

const names = (nodes: readonly TreeNode[]): string[] => nodes.map((node) => node.key);

describe('the accessible tree', () => {
	it('lists families and standalone items together, newest anchor first', () => {
		const { tree } = treeOf((b) => {
			b.add({ status: 'ready', created: b.now - 9 * DAY });
			const epic = b.add({ type: 'epic', status: 'in_progress', created: b.now - 20 * DAY });
			b.add({ parentKey: epic.key, status: 'done', completed: b.now - 10 * DAY });
			// The family's newest anchor is this child's, which is the newest thing on the board.
			b.add({ parentKey: epic.key, status: 'in_progress', created: b.now - 12 * DAY, started: b.now - 1000 });
			b.add({ status: 'ready', created: b.now - 3 * DAY });
		});
		expect(names(tree.roots)).toEqual(['MAP-2', 'MAP-5', 'MAP-1']);
	});

	it('makes a family a group of its children, a level down, with the right set size and position', () => {
		const { tree } = treeOf((b) => {
			const epic = b.add({ type: 'epic', status: 'in_progress', created: b.now - 20 * DAY });
			b.add({ parentKey: epic.key, status: 'done', completed: b.now - 10 * DAY });
			b.add({ parentKey: epic.key, status: 'ready', created: b.now - 2 * DAY });
			b.add({ parentKey: epic.key, status: 'in_progress', created: b.now - 5 * DAY, started: b.now - DAY });
		});
		const epic = tree.roots[0]!;
		expect(epic).toMatchObject({ level: 1, setSize: 1, position: 1, expanded: true });
		expect(epic.children).toHaveLength(3);
		epic.children.forEach((child, i) => expect(child).toMatchObject({ level: 2, setSize: 3, position: i + 1, expanded: undefined, children: [] }));
		expect(names(epic.children)).toEqual(['MAP-4', 'MAP-3', 'MAP-2']);
	});

	it('nests a region inside a region, one more level down', () => {
		const { tree } = treeOf((b) => {
			const outer = b.add({ type: 'epic', status: 'in_progress' });
			const inner = b.add({ type: 'epic', status: 'in_progress', parentKey: outer.key });
			b.add({ parentKey: inner.key, status: 'ready' });
			b.add({ parentKey: inner.key, status: 'in_progress' });
			b.add({ parentKey: outer.key, status: 'ready' });
		});
		const outer = tree.roots[0]!;
		const inner = outer.children.find((child) => child.key === 'MAP-2')!;
		expect(inner).toMatchObject({ level: 2, expanded: true });
		expect(inner.children.map((child) => child.level)).toEqual([3, 3]);
	});

	it('mirrors collapse: a folded family is a closed item with its children out of the tree', () => {
		const { tree, layout } = treeOf((b) => {
			const done = b.add({ type: 'epic', status: 'done' });
			b.add({ parentKey: done.key, status: 'done' });
			b.add({ parentKey: done.key, status: 'done' });
			const open = b.add({ type: 'epic', status: 'in_progress' });
			b.add({ parentKey: open.key, status: 'ready' });
		});
		expect(layout.collapsed).toEqual(['MAP-1']);
		const folded = tree.nodes.get('MAP-1')!;
		expect(folded).toMatchObject({ expanded: false, children: [] });
		expect(folded.name).toContain('Collapsed, 2 items inside');
		expect(tree.nodes.has('MAP-2')).toBe(false);
		expect(tree.nodes.get('MAP-4')).toMatchObject({ expanded: true });
	});

	it('opens again when the person expands it', () => {
		const { tree } = treeOf((b) => {
			const done = b.add({ type: 'epic', status: 'done' });
			b.add({ parentKey: done.key, status: 'done' });
			b.add({ parentKey: done.key, status: 'done' });
			b.add({ status: 'ready' });
		}, { 'MAP-1': false });
		expect(tree.nodes.get('MAP-1')).toMatchObject({ expanded: true });
		expect(tree.nodes.get('MAP-1')!.children).toHaveLength(2);
	});

	it('gives every node a distinct id', () => {
		const { tree } = treeOf((b) => {
			const epic = b.add({ type: 'epic', status: 'in_progress' });
			b.add({ parentKey: epic.key, status: 'ready' });
			b.add({ status: 'ready' });
		});
		const ids = [...tree.nodes.values()].map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => id.startsWith('tree-'))).toBe(true);
	});

	it('puts key, title, and status in each item\'s name', () => {
		const { tree } = treeOf((b) => {
			b.add({ status: 'in_progress', title: 'Index the notes' });
			b.add({ status: 'done', title: 'Ship it' });
			b.add({ status: 'in_review', subStatus: 'pr_open', title: 'Review me' });
		});
		expect(tree.nodes.get('MAP-1')!.name).toBe('MAP-1: Index the notes, In Progress');
		expect(tree.nodes.get('MAP-2')!.name).toBe('MAP-2: Ship it, Done');
		expect(tree.nodes.get('MAP-3')!.name).toContain('MAP-3: Review me, In Review, PR open');
	});

	it('adds why an item needs a person, what it waits on, whether it is up next, and a live session', () => {
		const { tree } = treeOf((b) => {
			const blocker = b.add({ status: 'in_progress', title: 'First' });
			b.work(blocker, 'session', 'laptop', 1);
			const waiting = b.add({ status: 'ready', title: 'Second' });
			b.block(waiting, blocker);
			b.add({ status: 'ready', subStatus: 'needs_input', title: 'Asked' });
			b.add({ status: 'ready', textBlockerCount: 2, blocked: true, title: 'Held' });
		});
		expect(tree.nodes.get('MAP-1')!.name).toContain('Live agent session');
		expect(tree.nodes.get('MAP-2')!.name).toContain('Waiting on MAP-1');
		expect(tree.nodes.get('MAP-3')!.name).toContain('Needs a person: An agent asked a question');
		expect(tree.nodes.get('MAP-3')!.name).toContain('Needs input');
		expect(tree.nodes.get('MAP-4')!.name).toContain('2 holds');
		expect(tree.nodes.get('MAP-4')!.name).toContain('Needs a person: Held by a text blocker');
	});

	it('numbers what is up next', () => {
		const { tree, layout } = treeOf((b) => {
			b.add({ status: 'ready', title: 'Soon' });
			b.add({ status: 'ready', title: 'Later' });
		});
		const first = layout.upNext[0]!;
		expect(tree.nodes.get(first)!.name).toContain('Up next, number 1');
	});

	it('puts the agents last, in a group of computers holding their sessions, and counts them among the top level', () => {
		const { tree } = treeOf((b) => {
			const a = b.add({ status: 'in_progress', title: 'On the laptop' });
			const c = b.add({ status: 'in_progress', title: 'On the desktop' });
			b.add({ status: 'ready' });
			b.work(a, 'one', 'laptop', 2);
			b.work(c, 'two', 'desktop', 40);
		});
		const agents = tree.roots.at(-1)!;
		expect(agents.key).toBe('agents');
		expect(agents).toMatchObject({ level: 1, expanded: true, position: 4, setSize: 4 });
		expect(agents.name).toBe('Agents at work: 2 computers, 2 sessions');
		expect(tree.roots.slice(0, -1).every((root) => root.setSize === 4)).toBe(true);
		expect(agents.children.map((computer) => computer.name).sort()).toEqual(['Computer desktop, quiet, 1 session', 'Computer laptop, live, 1 session']);
		const laptop = agents.children.find((computer) => computer.name.includes('laptop'))!;
		expect(laptop).toMatchObject({ level: 2, setSize: 2, expanded: true });
		expect(laptop.children[0]).toMatchObject({ level: 3, setSize: 1, position: 1 });
		expect(laptop.children[0]!.name).toContain('Session 1 on laptop, live');
		expect(laptop.children[0]!.name).toContain('on MAP-1');
	});

	it('has no agents group when nobody is working', () => {
		const { tree } = treeOf((b) => {
			b.add({ status: 'ready' });
		});
		expect(tree.roots.map((root) => root.key)).toEqual(['MAP-1']);
		expect(tree.roots[0]!.setSize).toBe(1);
	});

	it('is named for the Map, with its size', () => {
		expect(treeOf((b) => b.add({ status: 'ready' })).tree.label).toBe('Map of 1 item');
		expect(treeOf((b) => { b.add({ status: 'ready' }); b.add({ status: 'ready' }); }).tree.label).toBe('Map of 2 items');
	});

	it('treats an item whose parent the read doesn\'t carry as standalone', () => {
		const { tree } = treeOf((b) => {
			b.add({ status: 'ready', parentKey: 'MAP-404' });
		});
		expect(tree.roots).toHaveLength(1);
		expect(tree.roots[0]).toMatchObject({ level: 1 });
	});

	describe('the active item', () => {
		it('is the focused key\'s own item', () => {
			const { tree, layout } = treeOf((b) => {
				b.add({ status: 'ready' });
			});
			expect(activeNode(tree, layout, 'MAP-1')).toBe(tree.nodes.get('MAP-1'));
		});

		it('is the folded family for an item inside it, and a session by its node key', () => {
			const { tree, layout } = treeOf((b) => {
				const done = b.add({ type: 'epic', status: 'done' });
				b.add({ parentKey: done.key, status: 'done' });
				const w = b.add({ status: 'in_progress' });
				b.work(w, 'sess', 'laptop', 1);
			});
			expect(activeNode(tree, layout, 'MAP-2')).toBe(tree.nodes.get('MAP-1'));
			expect(activeNode(tree, layout, 'session:sess')).toBe(tree.nodes.get('session:sess'));
		});

		it('is nothing for no focus or a key the tree doesn\'t have', () => {
			const { tree, layout } = treeOf((b) => {
				b.add({ status: 'ready' });
			});
			expect(activeNode(tree, layout, null)).toBeNull();
			expect(activeNode(tree, layout, 'MAP-9')).toBeNull();
		});
	});

	it('orders by the newest anchor in a subtree, from the row times', () => {
		const { tree } = treeOf((b) => {
			b.add({ status: 'done', completed: b.now - 5 * DAY });
			const parent = b.add({ type: 'epic', status: 'in_progress', created: b.now - 40 * DAY });
			const child = b.add({ parentKey: parent.key, status: 'ready', created: b.now - 30 * DAY });
			child.timeAnchor = iso(b.now - 1 * DAY);
		});
		expect(names(tree.roots)).toEqual(['MAP-2', 'MAP-1']);
	});
});
