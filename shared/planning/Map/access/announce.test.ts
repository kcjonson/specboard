import { describe, expect, it, vi } from 'vitest';
import { BoardBuilder } from '../layout/board-fixture';
import { Announcer, MIN_GAP_MS, announcementText, summarizeChanges, type ChangeSummary } from './announce';

const change = (key: string, text = `${key} changed`): ChangeSummary => ({ key, text });

/** An announcer on a clock the test drives, with timers it runs by hand. */
function announcer(): { announcer: Announcer; said: string[]; clock: { now: number }; advance: (ms: number) => void } {
	const said: string[] = [];
	const clock = { now: 1_000_000 };
	const timers = new Map<number, { at: number; task: () => void }>();
	let next = 1;
	const advance = (ms: number): void => {
		clock.now += ms;
		for (const [id, timer] of [...timers]) {
			if (timer.at <= clock.now) {
				timers.delete(id);
				timer.task();
			}
		}
	};
	const instance = new Announcer({
		say: (text) => said.push(text),
		now: () => clock.now,
		later: (task, ms) => {
			const id = next++;
			timers.set(id, { at: clock.now + ms, task });
			return id;
		},
		cancel: (handle) => void timers.delete(handle as number),
	});
	return { announcer: instance, said, clock, advance };
}

describe('the announcer', () => {
	it('says the first change after a quiet stretch at once', () => {
		const { announcer: a, said } = announcer();
		a.push([change('A')]);
		expect(said).toEqual(['A changed']);
	});

	it('holds what arrives inside the gap and says it together when the gap has passed', () => {
		const { announcer: a, said, advance } = announcer();
		a.push([change('A')]);
		advance(1000);
		a.push([change('B')]);
		advance(1000);
		a.push([change('C')]);
		expect(said).toEqual(['A changed']);
		advance(MIN_GAP_MS);
		expect(said).toEqual(['A changed', 'B changed; C changed']);
	});

	it('says at most one thing per gap however many changes arrive', () => {
		const { announcer: a, said, advance } = announcer();
		for (let i = 0; i < 40; i++) {
			a.push([change(`K${i}`)]);
			advance(500);
		}
		advance(MIN_GAP_MS);
		// 20 seconds of changes, one every half second: a few announcements, never one per change.
		expect(said.length).toBeLessThanOrEqual(5);
		expect(said.length).toBeGreaterThanOrEqual(2);
	});

	it('says an item once, with the newest word on it', () => {
		const { announcer: a, said, advance } = announcer();
		a.push([change('A')]);
		a.push([change('B', 'B first'), change('C')]);
		a.push([change('B', 'B again')]);
		advance(MIN_GAP_MS);
		expect(said).toEqual(['A changed', 'C changed; B again']);
	});

	it('counts the rest of a big batch instead of reading it out', () => {
		expect(announcementText(Array.from({ length: 7 }, (_, i) => change(`K${i}`)))).toBe('7 changes: K0 changed; K1 changed; and 5 more');
		expect(announcementText([change('A'), change('B'), change('C')])).toBe('A changed; B changed; C changed');
	});

	it('says nothing, now or later, once it is turned off, and drops what it was holding', () => {
		const { announcer: a, said, advance } = announcer();
		a.push([change('A')]);
		a.push([change('B')]);
		a.setEnabled(false);
		advance(MIN_GAP_MS * 2);
		a.push([change('C')]);
		advance(MIN_GAP_MS * 2);
		expect(said).toEqual(['A changed']);
		expect(a.enabled).toBe(false);
	});

	it('says what comes after it is turned back on, and never what was dropped while it was off', () => {
		const { announcer: a, said, advance } = announcer();
		a.setEnabled(false);
		a.push([change('A')]);
		a.setEnabled(true);
		advance(MIN_GAP_MS * 2);
		expect(said).toEqual([]);
		a.push([change('B')]);
		expect(said).toEqual(['B changed']);
	});

	it('says the answer to a person\'s own key at once, on or off, outside the gap', () => {
		const { announcer: a, said } = announcer();
		a.push([change('A')]);
		a.say('Nothing needs a person right now');
		a.setEnabled(false);
		a.say('No live agent sessions right now');
		expect(said).toEqual(['A changed', 'Nothing needs a person right now', 'No live agent sessions right now']);
	});

	it('does nothing for an empty batch, and nothing once disposed', () => {
		const { announcer: a, said, advance } = announcer();
		a.push([]);
		a.push([change('A')]);
		a.push([change('B')]);
		a.dispose();
		advance(MIN_GAP_MS * 2);
		expect(said).toEqual(['A changed']);
	});

	it('cancels its timer when turned off', () => {
		const cancel = vi.fn();
		const a = new Announcer({ say: () => {}, now: () => 0, later: () => 7, cancel });
		a.push([change('A')]);
		a.push([change('B')]);
		a.setEnabled(false);
		expect(cancel).toHaveBeenCalledWith(7);
	});
});

describe('what a change is', () => {
	const rows = (build: (b: BoardBuilder) => void): Map<string, ReturnType<BoardBuilder['add']>> => {
		const b = new BoardBuilder();
		build(b);
		return new Map(b.rows.map((row) => [row.key, { ...row, workers: [...row.workers] }]));
	};

	it('is nothing when the reads match', () => {
		const a = rows((b) => b.add({ status: 'ready' }));
		expect(summarizeChanges(a, new Map(a))).toEqual([]);
	});

	it('is an item filed, and an item gone', () => {
		const before = rows((b) => b.add({ status: 'ready', title: 'Old' }));
		const after = rows((b) => {
			b.add({ status: 'ready', title: 'Old' });
			b.add({ status: 'ready', title: 'New one' });
		});
		expect(summarizeChanges(before, after)).toEqual([{ key: 'MAP-2', text: 'MAP-2 New one: filed' }]);
		expect(summarizeChanges(after, before)).toEqual([{ key: 'MAP-2', text: 'MAP-2 New one: removed' }]);
	});

	it('is a new status, a question, a PR, and an agent arriving, one line per item', () => {
		const before = rows((b) => b.add({ status: 'in_progress', title: 'Work' }));
		const after = rows((b) => {
			const row = b.add({ status: 'in_review', subStatus: 'needs_input', prUrl: 'https://github.com/a/b/pull/4', title: 'Work' });
			b.work(row, 'new', 'laptop', 1);
		});
		expect(summarizeChanges(before, after)).toEqual([{ key: 'MAP-1', text: 'MAP-1 Work: now In Review, needs input, PR opened, an agent started on it' }]);
	});

	it('leaves alone what isn\'t news: a title edit, an agent writing again, a status that held', () => {
		const before = rows((b) => {
			const row = b.add({ status: 'in_progress', title: 'Work' });
			b.work(row, 'same', 'laptop', 30);
		});
		const after = rows((b) => {
			const row = b.add({ status: 'in_progress', title: 'Work, retitled' });
			b.work(row, 'same', 'laptop', 1);
		});
		expect(summarizeChanges(before, after)).toEqual([]);
	});
});
