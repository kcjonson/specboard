import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import { RelationIndex } from './relations';

/**
 * An epic holding a chain (done a, then m in flight, then c, then d), a loose item
 * that waits on the same finished a, and a discovered-from lineage off d.
 */
interface Fixture {
	index: RelationIndex;
	layout: MapLayout;
	epic: string;
	a: string;
	m: string;
	c: string;
	d: string;
	sibling: string;
	found: string;
	deep: string;
	stranger: string;
}

function board(): Fixture {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const a = b.add({ parentKey: epic.key, status: 'done' });
	const m = b.add({ parentKey: epic.key, status: 'in_progress' });
	b.block(m, a);
	const c = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(c, m);
	const d = b.add({ parentKey: epic.key, status: 'ready' });
	b.block(d, c);
	const sibling = b.add({ status: 'ready' });
	b.block(sibling, a);
	const found = b.add({ status: 'ready', discoveredFromKey: d.key });
	const deep = b.add({ status: 'ready', discoveredFromKey: found.key });
	const stranger = b.add({ status: 'ready' });
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const index = new RelationIndex(layout, rows);
	return { index, layout, epic: epic.key, a: a.key, m: m.key, c: c.key, d: d.key, sibling: sibling.key, found: found.key, deep: deep.key, stranger: stranger.key };
}

describe('the related set of a dot', () => {
	it('is its region, and its blocker chain both ways, transitively, satisfied links included', () => {
		const { index, epic, a, m, c, d, sibling, stranger } = board();
		const relation = index.relation(m)!;
		expect(relation).toMatchObject({ key: m, region: false, outline: epic });
		// What it waits on (a, whose link is satisfied) and what waits on it, down the chain (c, then d).
		for (const key of [a, m, c, d]) expect(relation.dots.has(key)).toBe(true);
		expect(relation.regions.has(epic)).toBe(true);
		// A sibling that waits on the same blocker isn't on its chain, and a stranger isn't related at all.
		expect(relation.dots.has(sibling)).toBe(false);
		expect(relation.dots.has(stranger)).toBe(false);
		for (const id of [`blocker:${a}>${m}`, `chain:${a}>${m}`, `blocker:${m}>${c}`, `blocker:${c}>${d}`]) expect(relation.links.has(id)).toBe(true);
		expect(relation.links.has(`blocker:${a}>${sibling}`)).toBe(false);
	});

	it('follows a chain in only the direction it was asked, up from the end and down from the start', () => {
		const { index, a, m, c, d } = board();
		const end = index.relation(d)!;
		for (const key of [a, m, c, d]) expect(end.dots.has(key)).toBe(true);
		const start = index.relation(a)!;
		for (const key of [m, c, d]) expect(start.dots.has(key)).toBe(true);
	});

	it('takes in the discovered-from lineage both ways, dotted links named by kind', () => {
		const { index, d, found, deep, stranger } = board();
		const middle = index.relation(found)!;
		expect(middle.dots.has(d)).toBe(true);
		expect(middle.dots.has(deep)).toBe(true);
		expect(middle.dots.has(stranger)).toBe(false);
		expect(middle.links.has(`discovered:${d}>${found}`)).toBe(true);
		expect(middle.links.has(`discovered:${found}>${deep}`)).toBe(true);
		// From the far end it reaches back through the whole lineage.
		const last = index.relation(deep)!;
		expect(last.dots.has(found)).toBe(true);
		expect(last.dots.has(d)).toBe(true);
	});

	it('is just the dot for an item with no region and no relations', () => {
		const { index, stranger } = board();
		const relation = index.relation(stranger)!;
		expect([...relation.dots]).toEqual([stranger]);
		expect(relation.outline).toBeNull();
		expect(relation.links.size).toBe(0);
	});

	it('is null for an item the Map does not draw', () => {
		expect(board().index.relation('NOPE-1')).toBeNull();
	});

	it('survives a blocker cycle', () => {
		const b = new BoardBuilder();
		const x = b.add({ status: 'ready' });
		const y = b.add({ status: 'ready' });
		b.block(x, y, 'open');
		b.block(y, x, 'open');
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		const index = new RelationIndex(layout, new Map(b.rows.map((row) => [row.key, row])));
		expect([...index.relation(x.key)!.dots].sort()).toEqual([x.key, y.key].sort());
	});
});

describe('the related set of a region', () => {
	it('lights its family, the outline darkens, and nothing else is related', () => {
		const { index, layout, epic, a, m, c, d, sibling } = board();
		const relation = index.relation(epic)!;
		expect(index.isRegion(epic)).toBe(true);
		expect(relation).toMatchObject({ key: epic, region: true, outline: epic });
		expect([...relation.dots].sort()).toEqual([a, m, c, d].sort());
		expect(relation.dots.has(sibling)).toBe(false);
		expect(relation.regions.has(epic)).toBe(true);
		expect(layout.regions.map((r) => r.key)).toContain(epic);
	});

	it('keeps the regions around and inside it at full strength when regions nest', () => {
		const b = new BoardBuilder();
		const outer = b.add({ type: 'epic', status: 'in_progress' });
		const inner = b.add({ type: 'epic', parentKey: outer.key, status: 'in_progress' });
		const leaf = b.add({ parentKey: inner.key, status: 'ready' });
		const sibling = b.add({ parentKey: outer.key, status: 'ready' });
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		const index = new RelationIndex(layout, new Map(b.rows.map((row) => [row.key, row])));

		const outerRelation = index.relation(outer.key)!;
		expect(outerRelation.regions.has(inner.key)).toBe(true);
		expect(outerRelation.dots.has(leaf.key)).toBe(true);
		expect(outerRelation.dots.has(sibling.key)).toBe(true);

		// A child of the inner region lights that region, and the one around it keeps its ground.
		const leafRelation = index.relation(leaf.key)!;
		expect(leafRelation.outline).toBe(inner.key);
		expect(leafRelation.regions.has(outer.key)).toBe(true);
		expect(leafRelation.dots.has(sibling.key)).toBe(false);
	});
});

describe('the related set of a folded family', () => {
	it('is read at the dot that draws it', () => {
		const b = new BoardBuilder();
		const parent = b.add({ type: 'epic', status: 'done' });
		const child = b.add({ parentKey: parent.key, status: 'done' });
		const after = b.add({ status: 'ready' });
		b.block(after, child);
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: { [parent.key]: true }, aspect: 2 });
		const index = new RelationIndex(layout, new Map(b.rows.map((row) => [row.key, row])));
		const relation = index.relation(child.key)!;
		expect(relation.key).toBe(parent.key);
		expect(relation.dots.has(after.key)).toBe(true);
		expect(index.isRegion(parent.key)).toBe(false);
	});
});

describe('what a computer, a session, and the item it works on light', () => {
	function agents(): { index: RelationIndex; epic: string; one: string; two: string; elsewhere: string; stranger: string } {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const one = b.add({ parentKey: epic.key, status: 'in_progress' });
		const two = b.add({ parentKey: epic.key, status: 'in_progress' });
		const elsewhere = b.add({ status: 'in_progress' });
		const stranger = b.add({ status: 'in_progress' });
		b.work(one, 'a', 'laptop');
		b.work(two, 'b', 'laptop');
		b.work(elsewhere, 'c', 'desktop');
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		return { index: new RelationIndex(layout, new Map(b.rows.map((row) => [row.key, row]))), epic: epic.key, one: one.key, two: two.key, elsewhere: elsewhere.key, stranger: stranger.key };
	}

	it('an item lights the sessions on it and their computers, and not the other sessions on that computer', () => {
		const { index, one } = agents();
		const relation = index.relation(one)!;
		expect(relation.dots.has('session:a')).toBe(true);
		expect(relation.dots.has('computer:laptop')).toBe(true);
		expect(relation.dots.has('session:b')).toBe(false);
		expect(relation.dots.has('computer:desktop')).toBe(false);
	});

	it('a session lights its computer and the items it is on, with the families they are drawn in', () => {
		const { index, epic, one, two } = agents();
		const relation = index.relation('session:a')!;
		expect(relation).toMatchObject({ key: 'session:a', region: false, outline: null });
		expect([...relation.dots].sort()).toEqual(['computer:laptop', 'session:a', one].sort());
		expect(relation.dots.has(two)).toBe(false);
		expect(relation.regions.has(epic)).toBe(true);
	});

	it('a computer lights every session on it and every item they are on', () => {
		const { index, one, two, elsewhere, stranger } = agents();
		const relation = index.relation('computer:laptop')!;
		expect([...relation.dots].sort()).toEqual(['computer:laptop', 'session:a', 'session:b', one, two].sort());
		expect(relation.dots.has(elsewhere)).toBe(false);
		expect(relation.dots.has(stranger)).toBe(false);
	});

	it('names no link: the agent lines draw at rest, and fade with whatever they leave', () => {
		const { index } = agents();
		expect(index.relation('computer:laptop')!.links.size).toBe(0);
		expect(index.relation('session:c')!.links.size).toBe(0);
	});

	it('lights an item\'s sessions through the collapsed family that draws it', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		const child = b.add({ parentKey: epic.key, status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'ready' });
		b.work(child, 'a', 'laptop');
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: { [epic.key]: true }, aspect: 2 });
		const index = new RelationIndex(layout, new Map(b.rows.map((row) => [row.key, row])));
		expect(index.relation(epic.key)!.dots.has('session:a')).toBe(true);
		expect(index.relation('session:a')!.dots.has(epic.key)).toBe(true);
	});

	it('has no relation for a session the layout does not know', () => {
		expect(agents().index.relation('session:nope')).toBeNull();
	});
});
