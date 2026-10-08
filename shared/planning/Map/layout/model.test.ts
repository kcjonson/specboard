import { describe, expect, it } from 'vitest';
import { BoardBuilder, NOW, iso } from './board-fixture';
import { buildModel, compareKeys } from './model';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('buildModel', () => {
	it('orders keys by number, not by string', () => {
		expect(['MAP-10', 'MAP-9', 'MAP-100'].sort(compareKeys)).toEqual(['MAP-9', 'MAP-10', 'MAP-100']);
	});

	it('puts every item in exactly one phase', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		const progress = b.add({ status: 'in_progress' });
		const review = b.add({ status: 'in_review' });
		const startedHold = b.add({ status: 'blocked', blocked: true, started: NOW - DAY });
		const hold = b.add({ status: 'blocked', blocked: true });
		const next = b.add({ status: 'ready' });
		const later = b.add({ status: 'ready' });
		b.block(later, next);
		const { items } = buildModel(b.rows, NOW, {});
		const phase = (key: string): string => items.find((i) => i.key === key)!.phase;
		expect(phase(done.key)).toBe('done');
		expect(phase(progress.key)).toBe('in_flight');
		expect(phase(review.key)).toBe('in_flight');
		expect(phase(startedHold.key)).toBe('in_flight');
		expect(phase(hold.key)).toBe('later');
		expect(phase(next.key)).toBe('next');
		expect(phase(later.key)).toBe('later');
	});

	it('anchors a parent at the newest anchor in its subtree', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress', created: NOW - 30 * DAY, started: NOW - 30 * DAY });
		const sub = b.add({ type: 'epic', parentKey: epic.key, status: 'in_progress', created: NOW - 20 * DAY, started: NOW - 20 * DAY });
		b.add({ parentKey: sub.key, status: 'done', completed: NOW - 2 * DAY });
		b.add({ parentKey: epic.key, status: 'done', completed: NOW - 9 * DAY });
		const { byKey } = buildModel(b.rows, NOW, {});
		expect(byKey.get(epic.key)!.anchor).toBe(NOW - 2 * DAY);
		expect(byKey.get(sub.key)!.anchor).toBe(NOW - 2 * DAY);
	});

	it('collapses finished families by default and honors a person’s choices', () => {
		const b = new BoardBuilder();
		const finished = b.add({ type: 'epic', status: 'done' });
		const child = b.add({ parentKey: finished.key, status: 'done' });
		const open = b.add({ type: 'epic', status: 'in_progress' });
		const openChild = b.add({ parentKey: open.key, status: 'ready' });

		const byDefault = buildModel(b.rows, NOW, {});
		expect(byDefault.byKey.get(child.key)!.rep.key).toBe(finished.key);
		expect(byDefault.byKey.get(finished.key)!.hub).toBe(false);
		expect(byDefault.byKey.get(open.key)!.hub).toBe(true);

		const chosen = buildModel(b.rows, NOW, { [finished.key]: false, [open.key]: true });
		expect(chosen.byKey.get(child.key)!.rep.key).toBe(child.key);
		expect(chosen.byKey.get(finished.key)!.hub).toBe(true);
		expect(chosen.byKey.get(openChild.key)!.rep.key).toBe(open.key);
	});

	it('folds a hidden family into its outermost collapsed ancestor', () => {
		const b = new BoardBuilder();
		const top = b.add({ type: 'epic', status: 'done' });
		const middle = b.add({ type: 'epic', parentKey: top.key, status: 'done' });
		const leaf = b.add({ parentKey: middle.key, status: 'done' });
		const { byKey } = buildModel(b.rows, NOW, {});
		expect(byKey.get(leaf.key)!.rep.key).toBe(top.key);
		expect(byKey.get(middle.key)!.rep.key).toBe(top.key);
		expect(byKey.get(top.key)!.radius).toBeCloseTo(6 + 2.3 * Math.sqrt(2));
	});

	it('marks blocker cycles and keeps them out of chains', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const [x, y, z] = [0, 1, 2].map(() => b.add({ parentKey: epic.key, status: 'ready' }));
		b.block(y!, x!);
		b.block(z!, y!);
		b.block(x!, z!);
		const model = buildModel(b.rows, NOW, {});
		expect(model.edges.every((e) => e.cyclic)).toBe(true);
		expect(model.deadlocked).toEqual([x!.key, y!.key, z!.key]);
		expect(model.chains).toEqual([]);
	});

	it('sizes a family the read folded like the same family collapsed', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'done' });
		for (let i = 0; i < 3; i++) b.add({ parentKey: epic.key, status: 'done' });
		const folded = b.add({ type: 'epic', status: 'done', summarizedDescendants: 3 });
		const { byKey } = buildModel(b.rows, NOW, {});
		expect(byKey.get(folded.key)!.descendants).toBe(3);
		expect(byKey.get(folded.key)!.radius).toBe(byKey.get(epic.key)!.radius);
	});

	it('counts satisfied links in a chain', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const first = b.add({ parentKey: epic.key, status: 'done' });
		const second = b.add({ parentKey: epic.key, status: 'ready' });
		b.add({ parentKey: epic.key, status: 'ready' });
		b.block(second, first, 'satisfied');
		const model = buildModel(b.rows, NOW, {});
		expect(model.edges).toHaveLength(1);
		expect(model.chains).toHaveLength(1);
		expect(model.chains[0]!.items.map((i) => i.key)).toEqual([first.key, second.key]);
		expect([...model.chainBlocked].map((i) => i.key)).toEqual([second.key]);
	});

	it('stacks sibling chains, relating each to the next rather than to all', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		for (let chain = 0; chain < 3; chain++) {
			const first = b.add({ parentKey: epic.key, status: 'ready' });
			b.block(b.add({ parentKey: epic.key, status: 'ready' }), first);
		}
		const model = buildModel(b.rows, NOW, {});
		expect(model.chains).toHaveLength(3);
		expect(model.relatedChains).toEqual([
			[0, 1],
			[1, 2],
		]);
	});

	it('picks up next in the agents’ order: in-flight parents first, then the ready list', () => {
		const b = new BoardBuilder();
		const loose = b.add({ status: 'ready' });
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const blockedChild = b.add({ parentKey: epic.key, status: 'ready' });
		const readyChild = b.add({ parentKey: epic.key, status: 'ready' });
		b.block(blockedChild, b.add({ status: 'in_progress' }));
		const second = b.add({ status: 'ready' });
		const third = b.add({ status: 'ready' });
		const model = buildModel(b.rows, NOW, {});
		expect(model.upNext).toEqual([readyChild.key, loose.key, second.key]);
		expect(model.planOrder.slice(0, 4)).toEqual([readyChild.key, loose.key, second.key, third.key]);
		expect(model.planOrder).toContain(blockedChild.key);
	});

	it('plans each project on its own on a combined Map: every one has its own up next, in its own agents\' order', () => {
		const spe = new BoardBuilder(NOW, 'SPE');
		const epic = spe.add({ type: 'epic', status: 'in_progress' });
		const child = spe.add({ parentKey: epic.key, status: 'ready' });
		const speReady = [0, 1, 2].map(() => spe.add({ status: 'ready' }));
		const pln = new BoardBuilder(NOW, 'PLN');
		const plnReady = [0, 1, 2, 3].map(() => pln.add({ status: 'ready' }));
		pln.add({ status: 'in_progress' });

		const model = buildModel([...spe.rows, ...pln.rows], NOW, {});

		// One list across both would have held three items between them.
		expect(model.upNext).toEqual([...plnReady.slice(0, 3), child, ...speReady.slice(0, 2)].map((row) => row.key));
		expect(model.planOrder).toEqual([...plnReady, child, ...speReady].map((row) => row.key));
	});

	it('groups live sessions by computer and numbers them', () => {
		const b = new BoardBuilder();
		const one = b.add({ status: 'in_progress' });
		const two = b.add({ status: 'in_progress' });
		const three = b.add({ status: 'in_review' });
		const stale = b.add({ status: 'in_progress' });
		const finished = b.add({ status: 'done' });
		b.work(one, 's-b', 'laptop');
		b.work(two, 's-a', 'laptop');
		b.work(three, 's-a', 'laptop');
		b.work(two, 's-c', 'desk');
		b.work(stale, 's-d', 'laptop', 90);
		b.work(finished, 's-e', 'laptop');
		const { sessions, computers } = buildModel(b.rows, NOW, {});
		expect(computers.map((c) => [c.device, c.sessions.map((s) => s.key)])).toEqual([
			['desk', ['s-c']],
			['laptop', ['s-a', 's-b']],
		]);
		expect(sessions.find((s) => s.key === 's-a')!.items.map((i) => i.key)).toEqual([two.key, three.key]);
		expect(sessions.map((s) => s.number)).toEqual([1, 1, 2]);
	});

	it('does not depend on the order rows arrive in', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		for (let i = 0; i < 12; i++) b.add({ parentKey: epic.key, status: i % 2 ? 'done' : 'ready', created: NOW - i * HOUR });
		const forward = buildModel(b.rows, NOW, {});
		const backward = buildModel([...b.rows].reverse(), NOW, {});
		expect(backward.items.map((i) => i.key)).toEqual(forward.items.map((i) => i.key));
		expect(backward.planOrder).toEqual(forward.planOrder);
	});

	it('drops a parent link that would close a loop', () => {
		const b = new BoardBuilder();
		const a = b.add({ status: 'ready' });
		const c = b.add({ status: 'ready', parentKey: a.key });
		a.parentKey = c.key;
		const { byKey } = buildModel(b.rows, NOW, {});
		const roots = [byKey.get(a.key)!, byKey.get(c.key)!].filter((item) => !item.parent);
		expect(roots).toHaveLength(1);
	});

	it('falls back to the filed time when an anchor is unreadable', () => {
		const b = new BoardBuilder();
		const row = b.add({ status: 'ready', created: NOW - 3 * DAY });
		row.timeAnchor = 'not a time';
		expect(buildModel(b.rows, NOW, {}).byKey.get(row.key)!.anchor).toBe(Date.parse(iso(NOW - 3 * DAY)));
	});
});
