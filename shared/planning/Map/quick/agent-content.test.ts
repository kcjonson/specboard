import { describe, expect, it } from 'vitest';
import { agentsOf } from '../agents';
import { BoardBuilder } from '../layout/board-fixture';
import { MINUTE } from '../layout/constants';
import { layoutMap } from '../layout/layout';
import { AGENT_CARD_ROWS, agentCard, agentCardHeight, itemSessions } from './agent-content';

function scene(): { b: BoardBuilder; layout: ReturnType<typeof layoutMap>; rows: Map<string, ReturnType<BoardBuilder['add']>>; working: ReturnType<typeof agentsOf>; keys: string[] } {
	const b = new BoardBuilder();
	const items = Array.from({ length: 7 }, (_, i) => b.add({ status: 'in_progress', title: `Task ${i + 1}` }));
	b.work(items[0]!, 'aa', 'personal-laptop', 3, 130);
	b.work(items[0]!, 'bb', 'personal-laptop', 22, 60, 'codex');
	for (const item of items.slice(1, 6)) b.work(item, 'cc', 'build-box', 1, 20);
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	return { b, layout, rows, working: agentsOf(layout, rows, b.now), keys: items.map((item) => item.key) };
}

describe('the hover card for an item\'s sessions', () => {
	it('gives client, device, branch, time on the item, and time since the last write, newest write first', () => {
		const { b, rows, working, keys } = scene();
		expect(itemSessions(rows.get(keys[0]!)!, working, b.now)).toEqual([
			{
				title: 'Session 1, claude-code on personal-laptop',
				meta: { lead: `feat/${keys[0]}`, tail: '2 h 10 min on item, last write 3 min ago' },
				quiet: false,
			},
			{
				title: 'Session 2, codex on personal-laptop, quiet',
				meta: { lead: `feat/${keys[0]}`, tail: '1 h on item, last write 22 min ago' },
				quiet: true,
			},
		]);
	});

	it('still lists a session that has left the cluster, unnumbered and quiet, since the item\'s row has an open episode on it', () => {
		const { b, layout, rows, keys } = scene();
		const later = b.now + 2 * 60 * MINUTE;
		const [first] = itemSessions(rows.get(keys[0]!)!, agentsOf(layout, rows, later), later);
		expect(first).toMatchObject({ quiet: true });
		expect(first!.title).toBe('claude-code on personal-laptop, quiet');
	});

	it('says there is nothing when no session is on the item', () => {
		const { b, rows, working, keys } = scene();
		expect(itemSessions(rows.get(keys[6]!)!, working, b.now)).toEqual([]);
	});
});

describe('the hover card for a session and a computer', () => {
	it('a session names its place, agent, state, and each item with its branch and times', () => {
		const { b, rows, working, keys } = scene();
		const card = agentCard('session:aa', working, rows, b.now)!;
		expect(card).toMatchObject({
			kind: 'session',
			kicker: 'Agent session · last write 3 min ago',
			title: 'Session 1 on personal-laptop',
			chips: ['claude-code', 'Live'],
			more: 0,
		});
		expect(card.rows).toEqual([{ key: keys[0], title: 'Task 1', meta: { lead: `feat/${keys[0]}`, tail: '2 h 10 min on item, last write 3 min ago' } }]);
	});

	it('a quiet session says so', () => {
		const { b, rows, working } = scene();
		expect(agentCard('session:bb', working, rows, b.now)!.chips).toEqual(['codex', 'Quiet']);
	});

	it('a computer lists its sessions with their items and how many are live', () => {
		const { b, rows, working, keys } = scene();
		const card = agentCard('computer:personal-laptop', working, rows, b.now)!;
		expect(card).toMatchObject({ kind: 'computer', title: 'personal-laptop', chips: ['2 sessions', '1 live'], kicker: 'Computer · last write 3 min ago' });
		expect(card.rows).toEqual([
			{ key: 'Session 1', title: 'claude-code', meta: { lead: `${keys[0]}`, tail: 'last write 3 min ago' } },
			{ key: 'Session 2', title: 'codex', meta: { lead: `${keys[0]}`, tail: 'last write 22 min ago, quiet' } },
		]);
	});

	it('names a few items and counts the rest, and its height follows what it holds', () => {
		const { b, rows, working } = scene();
		const card = agentCard('session:cc', working, rows, b.now)!;
		expect(card.rows).toHaveLength(AGENT_CARD_ROWS);
		expect(card.more).toBe(1);
		const one = agentCard('session:aa', working, rows, b.now)!;
		// Three more rows of 32 px and the line for the rest, each with the card's 6 px gap.
		expect(agentCardHeight(card)).toBe(agentCardHeight(one) + 3 * (32 + 6) + (16 + 6));
	});

	it('has no card for a node that has left the cluster', () => {
		const { b, rows, working } = scene();
		expect(agentCard('session:gone', working, rows, b.now)).toBeNull();
	});
});
