import { describe, expect, it } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import { needsPerson } from './needs-person';

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
		expect([...needsPerson(b.rows, b.now)].sort()).toEqual([asked.key, prOpen.key, review.key, held.key].sort());
	});

	it('rings in-progress work whose sessions have all gone quiet, live or not on the Map', () => {
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
		const needing = needsPerson(b.rows, b.now);
		expect([...needing].sort()).toEqual([quiet.key, gone.key].sort());
		expect(needing.has(nobody.key)).toBe(false);
	});

	it('moves with the clock: the same rows ring once their sessions age past 15 minutes', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'in_progress' });
		b.work(item, 's1', 'laptop', 5);
		expect(needsPerson(b.rows, b.now).has(item.key)).toBe(false);
		expect(needsPerson(b.rows, b.now + 10 * 60_000).has(item.key)).toBe(false);
		expect(needsPerson(b.rows, b.now + 10 * 60_000 + 1).has(item.key)).toBe(true);
	});

	it('does not ring finished or unstarted work for a stale session', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		const ready = b.add({ status: 'ready' });
		b.work(done, 's1', 'laptop', 90);
		b.work(ready, 's1', 'laptop', 90);
		expect(needsPerson(b.rows, b.now).size).toBe(0);
	});
});
