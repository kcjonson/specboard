import { describe, expect, it } from 'vitest';
import { agentsOf } from './agents';
import { computerBlock } from './computer-blocks';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';

function working(): ReturnType<typeof agentsOf> {
	const b = new BoardBuilder();
	const spe206 = b.add({ status: 'in_progress' });
	const spe207 = b.add({ status: 'in_progress' });
	const spe209 = b.add({ status: 'in_progress' });
	const other = b.add({ status: 'in_progress' });
	// Item keys sort by number, so session one's items read in order whichever was written first.
	b.work(spe209, 'a', 'personal-laptop', 3);
	b.work(spe206, 'a', 'personal-laptop', 4);
	b.work(spe207, 'b', 'personal-laptop', 5, 90, 'codex');
	b.work(other, 'c', 'studio-desktop', 1);
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	return agentsOf(layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 }), rows, b.now);
}

describe('a computer\'s text block', () => {
	it('names the computer, then each session and the work on it, in key order', () => {
		const computer = working().computers.find((c) => c.device === 'personal-laptop')!;
		const block = computerBlock(computer, 'far');
		expect(block.node).toBe('computer:personal-laptop');
		expect(block.lines).toEqual([
			{ text: 'personal-laptop', strong: true },
			{ text: 'Session 1: MAP-1, MAP-3', strong: false },
			{ text: 'Session 2: MAP-2', strong: false },
		]);
	});

	it('lists the items it names, which get no label of their own', () => {
		const computer = working().computers.find((c) => c.device === 'personal-laptop')!;
		expect(computerBlock(computer, 'far').items).toEqual(['MAP-1', 'MAP-3', 'MAP-2']);
	});

	it('adds each session\'s agent once the Map is zoomed in', () => {
		const computer = working().computers.find((c) => c.device === 'personal-laptop')!;
		for (const level of ['middle', 'near'] as const) {
			expect(computerBlock(computer, level).lines.map((line) => line.text)).toEqual([
				'personal-laptop',
				'Session 1, claude-code: MAP-1, MAP-3',
				'Session 2, codex: MAP-2',
			]);
		}
	});

	it('makes one block per computer', () => {
		const { computers } = working();
		expect(computers.map((c) => computerBlock(c, 'far').lines[0]!.text)).toEqual(['personal-laptop', 'studio-desktop']);
	});
});
