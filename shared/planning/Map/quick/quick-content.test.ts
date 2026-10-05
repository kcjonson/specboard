import { describe, expect, it } from 'vitest';
import { BoardBuilder } from '../layout/board-fixture';
import { NAMED_BLOCKERS, progressText, quickContent, quickHeight, type QuickMarks } from './quick-content';

const NO_MARKS: QuickMarks = { reasons: [], upNext: null };

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
		const content = quickContent(item, rows, { done: 1, in_flight: 1, next: 2, later: 0 }, NO_MARKS);
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
		const content = quickContent(item, new Map(b.rows.map((row) => [row.key, row])), null, NO_MARKS);
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
		const base = quickHeight(quickContent(plain, rows, null, NO_MARKS));
		expect(quickHeight(quickContent(withHold, rows, null, NO_MARKS))).toBe(base + 6 + 16);
		expect(quickHeight(quickContent(plain, rows, { done: 1, in_flight: 0, next: 0, later: 0 }, NO_MARKS))).toBe(base + 6 + 18);
	});

	it('leads with why the item needs a person, every reason in words with the lead one first, and says which number it is up next', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'in_progress', subStatus: 'needs_input', textBlockerCount: 1 });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const content = quickContent(item, rows, null, { reasons: ['question', 'hold'], upNext: 2 });
		expect(content.needs).toEqual({ tag: '?', text: 'An agent asked a question; Held by a text blocker' });
		expect(content.upNext).toBe(2);
		expect(quickContent(item, rows, null, NO_MARKS)).toMatchObject({ needs: null, upNext: null });
	});

	it('adds a line to the card for the reason and one for the up-next number', () => {
		const b = new BoardBuilder();
		const item = b.add({ status: 'ready' });
		const rows = new Map(b.rows.map((row) => [row.key, row]));
		const base = quickHeight(quickContent(item, rows, null, NO_MARKS));
		expect(quickHeight(quickContent(item, rows, null, { reasons: ['review'], upNext: null }))).toBe(base + 6 + 16);
		expect(quickHeight(quickContent(item, rows, null, { reasons: [], upNext: 1 }))).toBe(base + 6 + 16);
		expect(quickHeight(quickContent(item, rows, null, { reasons: ['review'], upNext: 1 }))).toBe(base + 2 * (6 + 16));
	});
});
