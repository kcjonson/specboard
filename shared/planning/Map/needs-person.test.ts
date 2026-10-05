import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { REASON_ORDER, REASON_TAGS, REASON_TEXT, needsPerson, reasonsText, tagOf } from './needs-person';

const reasonsOf = (b: BoardBuilder, deadlocked: string[] = []): Map<string, readonly string[]> =>
	new Map(needsPerson(b.rows, { deadlocked }, b.now));

describe('needs a person, from the read', () => {
	it('rings a question, work waiting on review, and a text blocker, and nothing finished', () => {
		const b = new BoardBuilder();
		const asked = b.add({ status: 'in_progress', subStatus: 'needs_input' });
		const prOpen = b.add({ status: 'in_progress', subStatus: 'pr_open' });
		const review = b.add({ status: 'in_review' });
		const held = b.add({ status: 'ready', blocked: true, textBlockerCount: 2 });
		b.add({ status: 'in_progress', subStatus: 'in_development' });
		b.add({ status: 'ready' });
		b.add({ status: 'done', subStatus: 'pr_open', textBlockerCount: 1 });
		const reasons = needsPerson(b.rows, { deadlocked: [] }, b.now);
		expect([...reasons.keys()].sort()).toEqual([asked.key, prOpen.key, review.key, held.key].sort());
		expect(reasons.get(asked.key)).toEqual(['question']);
		expect(reasons.get(prOpen.key)).toEqual(['review']);
		expect(reasons.get(review.key)).toEqual(['review']);
		expect(reasons.get(held.key)).toEqual(['hold']);
	});

	it('gives an item every reason it has, the most pressing first', () => {
		const b = new BoardBuilder();
		const many = b.add({ status: 'in_review', subStatus: 'needs_input', textBlockerCount: 1 });
		expect(reasonsOf(b, [many.key]).get(many.key)).toEqual(['question', 'cycle', 'hold', 'review']);
	});

	it('rings every item in a blocker cycle, from the cycle the layout found', () => {
		const b = new BoardBuilder();
		const first = b.add({ status: 'ready' });
		const second = b.add({ status: 'ready' });
		const third = b.add({ status: 'ready' });
		const bystander = b.add({ status: 'ready' });
		b.block(first, second);
		b.block(second, third);
		b.block(third, first);
		b.block(bystander, first);
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		const reasons = needsPerson(b.rows, layout, b.now);
		expect([...reasons.keys()].sort()).toEqual([first.key, second.key, third.key].sort());
		for (const key of reasons.keys()) expect(reasons.get(key)).toEqual(['cycle']);
	});

	it('rings in-progress work whose sessions have all gone quiet, whether or not they are still on the Map', () => {
		const b = new BoardBuilder();
		const live = b.add({ status: 'in_progress' });
		const quiet = b.add({ status: 'in_progress' });
		const gone = b.add({ status: 'in_progress' });
		const mixed = b.add({ status: 'in_progress' });
		const nobody = b.add({ status: 'in_progress' });
		b.work(live, 's1', 'laptop', 14);
		b.work(quiet, 's1', 'laptop', 16);
		b.work(gone, 's2', 'laptop', 300);
		b.work(mixed, 's1', 'laptop', 40);
		b.work(mixed, 's3', 'laptop', 3);
		const reasons = needsPerson(b.rows, { deadlocked: [] }, b.now);
		expect([...reasons.keys()].sort()).toEqual([quiet.key, gone.key].sort());
		expect(reasons.get(quiet.key)).toEqual(['quiet']);
		expect(reasons.has(nobody.key)).toBe(false);
	});

	it('moves with the clock: the same rows ring once their sessions age past 15 minutes', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'in_progress' });
		b.work(item, 's1', 'laptop', 5);
		expect(needsPerson(b.rows, { deadlocked: [] }, b.now).has(item.key)).toBe(false);
		expect(needsPerson(b.rows, { deadlocked: [] }, b.now + 10 * 60_000).has(item.key)).toBe(false);
		expect(needsPerson(b.rows, { deadlocked: [] }, b.now + 10 * 60_000 + 1).has(item.key)).toBe(true);
	});

	it('does not ring finished or unstarted work for a stale session', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		const ready = b.add({ status: 'ready' });
		b.work(done, 's1', 'laptop', 90);
		b.work(ready, 's1', 'laptop', 90);
		expect(needsPerson(b.rows, { deadlocked: [] }, b.now).size).toBe(0);
	});

	it('does not ring a finished item that is still named in a cycle', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		expect(reasonsOf(b, [done.key]).size).toBe(0);
	});
});

describe('reason tags', () => {
	it('is ? for a question, PR for review, zz for a quiet agent, and ! for a hold or a deadlock', () => {
		expect(REASON_TAGS).toEqual({ question: '?', review: 'PR', quiet: 'zz', hold: '!', cycle: '!' });
	});

	it('takes the lead reason\'s tag, which is the most pressing one', () => {
		expect(tagOf(['question', 'review'])).toBe('?');
		expect(tagOf(['cycle', 'review'])).toBe('!');
		expect(tagOf(['review', 'quiet'])).toBe('PR');
		expect(tagOf(['quiet'])).toBe('zz');
	});

	it('says every reason in words, lead first, and has words for each', () => {
		for (const reason of REASON_ORDER) expect(REASON_TEXT[reason].length).toBeGreaterThan(0);
		expect(reasonsText(['question', 'review'])).toBe(`${REASON_TEXT.question}; ${REASON_TEXT.review}`);
	});
});
