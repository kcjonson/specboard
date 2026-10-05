import { describe, expect, it } from 'vitest';
import type { MapChange } from '@specboard/core/map-changes';
import { BoardBuilder } from '../layout/board-fixture';
import { formatDateTime } from '../../utils/time';
import { RECENT_LABELS, barTitle, baselineDate, changeLines, changedItems, recentChanged, summaryCounts, summaryText } from './changes';

const HOUR = 3_600_000;
const BASE = Date.parse('2026-09-19T12:00:00');
const at = (hours: number): number => BASE + hours * HOUR;
const change = (key: string, kind: MapChange['kind'], hours: number): MapChange => ({ key, kind, at: at(hours) });
const all = (): boolean => true;
const when = (hours: number): string => formatDateTime(new Date(at(hours)).toISOString());

describe('changedItems', () => {
	it('orders items by their latest change, oldest first, and an item appears once with all its changes', () => {
		const items = changedItems([
			change('A-3', 'finished', 5),
			change('A-1', 'worked_on', 1),
			change('A-2', 'filed', 2),
			change('A-1', 'pr_opened', 6),
		], all);

		expect(items.map((item) => item.key)).toEqual(['A-2', 'A-3', 'A-1']);
		expect(items.at(-1)).toMatchObject({ key: 'A-1', at: at(6) });
		expect(items.at(-1)!.changes.map((c) => c.kind)).toEqual(['worked_on', 'pr_opened']);
	});

	it('breaks a tie by item number, not by text', () => {
		const items = changedItems([change('A-10', 'filed', 1), change('A-9', 'filed', 1), change('A-100', 'filed', 1)], all);

		expect(items.map((item) => item.key)).toEqual(['A-9', 'A-10', 'A-100']);
	});

	it('leaves out an item the Map does not carry', () => {
		const items = changedItems([change('A-1', 'filed', 1), change('A-2', 'filed', 2)], (key) => key === 'A-2');

		expect(items.map((item) => item.key)).toEqual(['A-2']);
	});
});

describe('recentChanged', () => {
	it('is the latest changes, up to the count', () => {
		const items = changedItems(Array.from({ length: 12 }, (_, i) => change(`A-${i + 1}`, 'filed', i)), all);

		const recent = recentChanged(items);

		expect(recent.size).toBe(RECENT_LABELS);
		expect([...recent]).toEqual(Array.from({ length: RECENT_LABELS }, (_, i) => `A-${12 - RECENT_LABELS + 1 + i}`));
		expect(recentChanged(items, 2)).toEqual(new Set(['A-11', 'A-12']));
	});
});

describe('the summary', () => {
	const items = changedItems([
		...Array.from({ length: 11 }, (_, i) => change(`A-${i + 1}`, 'finished', i)),
		change('A-12', 'worked_on', 20),
		...Array.from({ length: 9 }, (_, i) => change(`A-${i + 20}`, 'filed', 30 + i)),
	], all);

	it('names each kind with how many items, in the strip\'s order', () => {
		expect(summaryText(items)).toEqual({
			full: '11 finished, 1 worked on, 9 filed',
			lead: '11 finished, +2 more kinds',
			total: '21 items changed',
		});
	});

	it('counts an item under every kind it has, once under each', () => {
		const two = changedItems([change('A-1', 'finished', 1), change('A-1', 'pr_opened', 2), change('A-1', 'pr_opened', 3)], all);

		expect(summaryCounts(two)).toEqual([{ kind: 'finished', count: 1 }, { kind: 'pr_opened', count: 1 }]);
	});

	it('words the attention kinds for one and for many', () => {
		const some = changedItems([
			change('A-1', 'blocked', 1), change('A-2', 'blocked', 1),
			change('A-3', 'question', 1),
			change('A-4', 'pr_opened', 1), change('A-5', 'pr_opened', 1),
		], all);

		expect(summaryText(some).full).toBe('2 blocked, 1 question, 2 PRs opened');
	});

	it('is empty when nothing changed', () => {
		expect(summaryText([])).toEqual({ full: '', lead: '', total: '' });
	});

	it('has no shorter forms when there is one kind, and says "kind" for one more', () => {
		const one = changedItems([change('A-1', 'finished', 1), change('A-2', 'finished', 2)], all);
		expect(summaryText(one)).toEqual({ full: '2 finished', lead: '2 finished', total: '2 finished' });

		const two = changedItems([change('A-1', 'finished', 1), change('A-2', 'filed', 2)], all);
		expect(summaryText(two).lead).toBe('1 finished, +1 more kind');
		expect(summaryText(two).total).toBe('2 items changed');
	});
});

describe('the baseline in words', () => {
	it('is a date for the bar and the strip', () => {
		const baseline = Date.parse('2026-09-19T12:00:00');
		expect(barTitle(baseline)).toBe(`Since your last visit, ${baselineDate(baseline)}`);
		expect(baselineDate(baseline)).toMatch(/Sep(tember)? 19/);
	});
});

describe('what a card says', () => {
	const b = new BoardBuilder();
	const source = b.add({ status: 'in_progress', title: 'The work it came from' });
	const found = b.add({ status: 'ready', title: 'A bug found on the way', originActorType: 'agent', discoveredFromKey: source.key });
	const byPerson = b.add({ status: 'ready', title: 'Filed by hand', originActorType: 'user' });
	const waiting = b.add({ status: 'ready', blocked: true, title: 'Waits on a thing' });
	b.block(waiting, source);
	const held = b.add({ status: 'ready', blocked: true, textBlockerCount: 1, title: 'Held' });
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const lines = (row: typeof found, changes: MapChange[]): string[] => changeLines(changedItems(changes, all)[0]!, row, rows);

	it('says what changed and when, a line for each, in the order they happened', () => {
		const out = lines(source, [change(source.key, 'pr_opened', 3), change(source.key, 'finished', 5), change(source.key, 'worked_on', 1)]);

		expect(out).toEqual([`Worked on ${when(1)}`, `PR opened ${when(3)}`, `Finished ${when(5)}`]);
	});

	it('calls out an agent-filed item with what it was discovered from', () => {
		expect(lines(found, [change(found.key, 'filed', 2)])).toEqual([
			`Filed by an agent ${when(2)}`,
			`Discovered from ${source.key} The work it came from`,
		]);
	});

	it('does not call out a person filing, or an agent filing with no source', () => {
		expect(lines(byPerson, [change(byPerson.key, 'filed', 2)])).toEqual([`Filed ${when(2)}`]);
		const loose = b.add({ status: 'ready', originActorType: 'agent' });
		expect(lines(loose, [change(loose.key, 'filed', 2)])).toEqual([`Filed by an agent ${when(2)}`]);
	});

	it('says blocked for an item waiting on another and held for one with only a hold', () => {
		expect(lines(waiting, [change(waiting.key, 'blocked', 4)])).toEqual([`Blocked ${when(4)}`]);
		expect(lines(held, [change(held.key, 'blocked', 4)])).toEqual([`Held ${when(4)}`]);
	});

	it('says a question was raised', () => {
		expect(lines(source, [change(source.key, 'question', 4)])).toEqual([`Question raised ${when(4)}`]);
	});
});
