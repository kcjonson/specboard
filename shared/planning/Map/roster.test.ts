import { describe, expect, it } from 'vitest';
import { agentsOf } from './agents';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import { liveCount, rosterOf } from './roster';

function scene(): { b: BoardBuilder; layout: ReturnType<typeof layoutMap>; rows: Map<string, ReturnType<BoardBuilder['add']>> } {
	const b = new BoardBuilder();
	const items = Array.from({ length: 6 }, (_, i) => b.add({ status: 'in_progress', title: `Task ${i + 1}` }));
	// The laptop's session 1 has gone quiet and session 2 is live, so the roster has to put the live one first.
	b.work(items[0]!, 'aa', 'personal-laptop', 25);
	b.work(items[1]!, 'aa', 'personal-laptop', 30);
	b.work(items[2]!, 'bb', 'personal-laptop', 2);
	b.work(items[3]!, 'bb', 'personal-laptop', 4);
	b.work(items[4]!, 'cc', 'build-box', 40);
	b.work(items[5]!, 'dd', 'build-box', 6);
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	return { b, rows, layout: layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 }) };
}

describe('the roster', () => {
	it('groups sessions by computer, each with its items, live sessions before quiet ones', () => {
		const { b, rows, layout } = scene();
		const groups = rosterOf(agentsOf(layout, rows, b.now), rows, b.now);
		expect(groups.map((group) => [group.label, group.live])).toEqual([['build-box', 1], ['personal-laptop', 1]]);
		expect(groups[1]!.sessions.map((s) => [s.number, s.state, s.items.map((item) => item.key)])).toEqual([
			[2, 'live', ['MAP-3', 'MAP-4']],
			[1, 'quiet', ['MAP-1', 'MAP-2']],
		]);
		expect(groups[0]!.sessions.map((s) => [s.number, s.state])).toEqual([[2, 'live'], [1, 'quiet']]);
	});

	it('says how long since each session wrote, and names the agent', () => {
		const { b, rows, layout } = scene();
		const [, laptop] = rosterOf(agentsOf(layout, rows, b.now), rows, b.now);
		expect(laptop!.sessions[0]).toMatchObject({ client: 'claude-code', lastWrite: 'last write 2 min ago' });
		expect(laptop!.sessions[1]!.lastWrite).toBe('last write 25 min ago');
	});

	it('carries each item\'s row, so a row can show its status', () => {
		const { b, rows, layout } = scene();
		const [first] = rosterOf(agentsOf(layout, rows, b.now), rows, b.now);
		expect(first!.sessions[0]!.items[0]).toMatchObject({ title: expect.stringMatching(/^Task /), row: { status: 'in_progress' } });
	});

	it('counts the live sessions, and a quiet one is not at work', () => {
		const { b, rows, layout } = scene();
		expect(liveCount(agentsOf(layout, rows, b.now))).toBe(2);
		expect(liveCount(agentsOf(layout, rows, b.now + 30 * 60_000))).toBe(0);
	});

	it('is empty when nothing has written in the last hour', () => {
		const { b, rows, layout } = scene();
		expect(rosterOf(agentsOf(layout, rows, b.now + 3 * 3_600_000), rows, b.now + 3 * 3_600_000)).toEqual([]);
	});
});
