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
		expect([...needsPerson(b.rows)].sort()).toEqual([asked.key, prOpen.key, review.key, held.key].sort());
	});
});
