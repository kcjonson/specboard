import { describe, expect, it } from 'vitest';
import { agentState, agentsOf, agoText, clientLabel, deviceLabel, spanText } from './agents';
import { BoardBuilder } from './layout/board-fixture';
import { MINUTE } from './layout/constants';
import { layoutMap } from './layout/layout';

const HOUR = 60 * MINUTE;

describe('agent state', () => {
	it('is live for 15 minutes, quiet to an hour, and gone after', () => {
		const now = 10 * HOUR;
		expect(agentState(now, now)).toBe('live');
		expect(agentState(now - 15 * MINUTE, now)).toBe('live');
		expect(agentState(now - 15 * MINUTE - 1, now)).toBe('quiet');
		expect(agentState(now - HOUR, now)).toBe('quiet');
		expect(agentState(now - HOUR - 1, now)).toBe('gone');
	});
});

/** Two computers: the laptop with two sessions (one live on two items, one quiet at 20 minutes), the desktop with one at 50 minutes. */
function board(): { b: BoardBuilder; rows: Map<string, ReturnType<BoardBuilder['add']>>; layout: ReturnType<typeof layoutMap>; keys: Record<string, string> } {
	const b = new BoardBuilder();
	const one = b.add({ status: 'in_progress' });
	const two = b.add({ status: 'in_progress' });
	const three = b.add({ status: 'in_progress' });
	const four = b.add({ status: 'in_progress' });
	b.add({ status: 'ready' });
	b.work(one, 'live-a', 'laptop', 2, 40);
	b.work(two, 'live-a', 'laptop', 11, 70);
	b.work(three, 'quiet-b', 'laptop', 20);
	b.work(four, 'old-c', 'desktop', 50);
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	return { b, rows, layout, keys: { one: one.key, two: two.key, three: three.key, four: four.key } };
}

describe('agents at a moment', () => {
	it('groups sessions by computer, numbers them as the layout does, and gives each its state and items', () => {
		const { b, rows, layout, keys } = board();
		const { computers, sessions } = agentsOf(layout, rows, b.now);
		expect(computers.map((c) => [c.device, c.live, c.sessions.map((s) => [s.number, s.key, s.state])])).toEqual([
			['desktop', false, [[1, 'old-c', 'quiet']]],
			['laptop', true, [[1, 'live-a', 'live'], [2, 'quiet-b', 'quiet']]],
		]);
		expect(sessions.find((s) => s.key === 'live-a')!.items.map((item) => item.key)).toEqual([keys.one, keys.two]);
		expect(sessions.find((s) => s.key === 'live-a')).toMatchObject({ node: 'session:live-a', computer: 'computer:laptop', client: 'claude-code' });
	});

	it('tells two people\'s computers of one name apart, by whose they are', () => {
		const b = new BoardBuilder();
		const one = b.add({ status: 'in_progress' });
		const two = b.add({ status: 'in_progress' });
		b.work(one, 'kevin-a', 'laptop', 2, 40, 'claude-code', 'Kevin Jonson');
		b.work(two, 'vera-a', 'laptop', 3, 40, 'claude-code', 'Vera Viewer');
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });

		const { computers } = agentsOf(layout, new Map(b.rows.map((row) => [row.key, row])), b.now);

		expect(computers.map((c) => deviceLabel(c.device))).toEqual(['Kevin Jonson\'s laptop', 'Vera Viewer\'s laptop']);
	});

	it('carries what each item\'s episode says: branch, start, and last write', () => {
		const { b, rows, layout, keys } = board();
		const session = agentsOf(layout, rows, b.now).sessions.find((s) => s.key === 'live-a')!;
		expect(session.items[0]).toEqual({
			key: keys.one,
			drawnBy: keys.one,
			branch: `feat/${keys.one}`,
			startedAt: b.now - 40 * MINUTE,
			lastWriteAt: b.now - 2 * MINUTE,
		});
		// A session is as live as its newest write on any item.
		expect(session.lastWriteAt).toBe(b.now - 2 * MINUTE);
	});

	it('ages without a new layout: live goes quiet at 15 minutes, and a session leaves after an hour', () => {
		const { b, rows, layout, keys } = board();
		const later = agentsOf(layout, rows, b.now + 14 * MINUTE);
		// live-a last wrote 2 minutes ago on one and 11 on the other; 14 minutes on, its newest write is 16 old.
		expect(later.sessions.find((s) => s.key === 'live-a')!.state).toBe('quiet');
		expect(later.sessions.find((s) => s.key === 'live-a')!.items.map((item) => item.key)).toEqual([keys.one, keys.two]);

		// 45 minutes on, the quiet session (last wrote at 20) and the desktop's (50) are past the hour; live-a's writes are at 47 and 56.
		const hourOn = agentsOf(layout, rows, b.now + 45 * MINUTE);
		expect(hourOn.sessions.map((s) => s.key)).toEqual(['live-a']);
		expect(hourOn.sessions[0]!.items.map((item) => item.key)).toEqual([keys.one, keys.two]);

		const gone = agentsOf(layout, rows, b.now + 2 * HOUR);
		expect(gone.computers).toEqual([]);
		expect(gone.sessions).toEqual([]);
	});

	it('drops a session\'s item once its own episode is more than an hour old, and the computer when nothing is left', () => {
		const { b, rows, layout, keys } = board();
		// 55 minutes on: the item written 2 minutes ago is at 57, the one written 11 minutes ago is at 66.
		const at = agentsOf(layout, rows, b.now + 55 * MINUTE);
		expect(at.sessions.find((s) => s.key === 'live-a')!.items.map((item) => item.key)).toEqual([keys.one]);
		// 11 minutes on, the desktop's only session (it last wrote 50 minutes before the layout) is past the hour, and its computer leaves with it.
		expect(agentsOf(layout, rows, b.now + 11 * MINUTE).computers.map((c) => c.device)).toEqual(['laptop']);
	});

	it('indexes computers and sessions by layout node', () => {
		const { b, rows, layout } = board();
		const { byNode } = agentsOf(layout, rows, b.now);
		expect([...byNode.keys()].sort()).toEqual(['computer:desktop', 'computer:laptop', 'session:live-a', 'session:old-c', 'session:quiet-b']);
	});

	it('has no agents on a board with no episodes', () => {
		const b = new BoardBuilder();
		b.add({ status: 'in_progress' });
		const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
		expect(agentsOf(layout, new Map(b.rows.map((row) => [row.key, row])), b.now).computers).toEqual([]);
	});
});

describe('how time reads', () => {
	it('says spans as a person would', () => {
		expect(spanText(20_000)).toBe('under a minute');
		expect(spanText(12 * MINUTE)).toBe('12 min');
		expect(spanText(2 * HOUR)).toBe('2 h');
		expect(spanText(2 * HOUR + 5 * MINUTE)).toBe('2 h 5 min');
		expect(spanText(3 * 24 * HOUR)).toBe('3 d');
		expect(agoText(20_000)).toBe('just now');
		expect(agoText(3 * MINUTE)).toBe('3 min ago');
	});

	it('names an agent or a computer that has no name', () => {
		expect(clientLabel(null)).toBe('Agent');
		expect(clientLabel('codex')).toBe('codex');
		expect(deviceLabel('')).toBe('Unknown computer');
		expect(deviceLabel('laptop')).toBe('laptop');
	});
});
