import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { buildDrawList } from './draw-list';

const drawn = (b: BoardBuilder, collapse: Record<string, boolean> = {}): ReturnType<typeof buildDrawList> => {
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	return buildDrawList(layoutMap({ rows: b.rows, now: b.now, collapse, aspect: 2 }), rows);
};

describe('the ink ring and its reason on the draw list', () => {
	it('gives a dot the lead reason it needs a person for: a question outranks review, a deadlock outranks a hold', () => {
		const b = new BoardBuilder();
		const both = b.add({ status: 'in_review', subStatus: 'needs_input' });
		const review = b.add({ status: 'in_review' });
		const hold = b.add({ status: 'ready', blocked: true, textBlockerCount: 1 });
		const first = b.add({ status: 'ready', textBlockerCount: 1 });
		const second = b.add({ status: 'ready' });
		b.block(first, second);
		b.block(second, first);
		b.add({ status: 'in_progress' });
		const { dots } = drawn(b);
		const reasons = new Map(dots.map((dot) => [dot.key, dot.reason]));
		expect(reasons.get(both.key)).toBe('question');
		expect(reasons.get(review.key)).toBe('review');
		expect(reasons.get(hold.key)).toBe('hold');
		expect(reasons.get(first.key)).toBe('cycle');
		expect(reasons.get(second.key)).toBe('cycle');
		expect(dots.filter((dot) => dot.reason === null)).toHaveLength(1);
	});

	it('rings a region\'s label when the parent itself needs a person', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress', subStatus: 'needs_input' });
		b.add({ parentKey: epic.key, status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'ready' });
		const { regions, dots } = drawn(b);
		expect(regions[0]!.reason).toBe('question');
		// Its children are their own dots, with no reason of their own.
		expect(dots.every((dot) => dot.reason === null)).toBe(true);
	});

	it('shows a folded family\'s dot the reason of whatever is inside it', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'done' });
		b.add({ parentKey: epic.key, status: 'in_review' });
		const { dots, regions } = drawn(b, { [epic.key]: true });
		expect(regions).toEqual([]);
		expect(dots.find((dot) => dot.key === epic.key)!.reason).toBe('review');
	});

	it('carries every item\'s reasons by key, for the quick card to lead with', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'in_progress', subStatus: 'needs_input', textBlockerCount: 1 });
		expect(drawn(b).needs.get(item.key)).toEqual(['question', 'hold']);
	});
});

describe('up next on the draw list', () => {
	it('numbers 1 to 3 in the agents\' order: the next ready child of each in-flight parent, then the top of the ready list', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'done' });
		b.add({ parentKey: epic.key, status: 'in_progress' });
		const childNext = b.add({ parentKey: epic.key, status: 'ready' });
		const other = b.add({ parentKey: epic.key, status: 'ready' });
		const topA = b.add({ status: 'ready' });
		const topB = b.add({ status: 'ready' });
		const topC = b.add({ status: 'ready' });
		const { dots } = drawn(b);
		const numbers = new Map(dots.filter((dot) => dot.upNext !== null).map((dot) => [dot.upNext, dot.key]));
		expect(numbers).toEqual(new Map([[1, childNext.key], [2, topA.key], [3, topB.key]]));
		expect(dots.find((dot) => dot.key === other.key)!.upNext).toBeNull();
		expect(dots.find((dot) => dot.key === topC.key)!.upNext).toBeNull();
	});

	it('numbers a parent drawn as a region on its label', () => {
		const b = new BoardBuilder();
		const parent = b.add({ type: 'epic', status: 'ready' });
		b.add({ parentKey: parent.key, status: 'ready' });
		b.add({ parentKey: parent.key, status: 'ready' });
		const { regions, dots } = drawn(b);
		expect(regions.find((region) => region.key === parent.key)!.upNext).toBe(1);
		expect(dots.every((dot) => dot.upNext === null)).toBe(true);
	});

	it('numbers a collapsed family\'s dot for an up-next item folded into it, with the lowest number inside', () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: epic.key, status: 'in_progress' });
		const inside = b.add({ parentKey: epic.key, status: 'ready' });
		const { dots } = drawn(b, { [epic.key]: true });
		const folded = dots.find((dot) => dot.key === epic.key)!;
		expect(folded.upNext).toBe(1);
		expect(dots.find((dot) => dot.key === inside.key)).toBeUndefined();
	});
});
