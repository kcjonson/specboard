import { describe, expect, it } from 'vitest';
import { BoardBuilder } from '../layout/board-fixture';
import { NAMED_BLOCKERS, progressText, quickContent, quickHeight } from './quick-content';

describe('quick card content', () => {
	it('says title, status, sub-status, sessions, open blockers by key and title, holds, and progress', () => {
		const b = new BoardBuilder();
		const first = b.add({ status: 'in_progress', title: 'Build the index' });
		const second = b.add({ status: 'ready', title: 'Wire the card' });
		const item = b.add({ status: 'in_progress', subStatus: 'needs_input', title: 'Hover card', textBlockerCount: 2 });
		b.block(item, first);
		b.block(item, second);
		b.work(item, 's1', 'laptop');
		b.work(item, 's2', 'desktop');
		b.work(item, 's1', 'laptop');
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const content = quickContent(item, rows, { done: 1, in_flight: 1, next: 2, later: 0 });
		expect(content).toMatchObject({
			key: item.key,
			title: 'Hover card',
			statusLabel: 'Blocked',
			subStatus: 'Needs input',
			sessions: 2,
			holds: 2,
			moreBlockers: 0,
		});
		expect(content.blockers).toEqual([
			{ key: first.key, title: 'Build the index' },
			{ key: second.key, title: 'Wire the card' },
		]);
		expect(progressText(content.progress!)).toBe('1 of 4 done');
	});

	it('names a few blockers and counts the rest, and leaves satisfied ones out', () => {
		const b = new BoardBuilder();
		const done = b.add({ status: 'done' });
		const open = Array.from({ length: NAMED_BLOCKERS + 2 }, () => b.add({ status: 'ready' }));
		const item = b.add({ status: 'ready' });
		b.block(item, done);
		for (const blocker of open) b.block(item, blocker);
		const content = quickContent(item, new Map(b.rows.map((row) => [row.key, row])), null);
		expect(content.blockers).toHaveLength(NAMED_BLOCKERS);
		expect(content.moreBlockers).toBe(2);
		expect(content.blockers.map((blocker) => blocker.key)).not.toContain(done.key);
		expect(content.sessions).toBeNull();
	});

	it('is as tall as the lines it carries, so placement needs no measuring', () => {
		const b = new BoardBuilder();
		const plain = b.add({ status: 'ready' });
		const withHold = b.add({ status: 'ready', textBlockerCount: 1 });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const base = quickHeight(quickContent(plain, rows, null));
		expect(quickHeight(quickContent(withHold, rows, null))).toBe(base + 6 + 16);
		expect(quickHeight(quickContent(plain, rows, { done: 1, in_flight: 0, next: 0, later: 0 }))).toBe(base + 6 + 18);
	});
});
