/**
 * The summary strip: counts, the counts that are filters, the slot for the roster button, and freshness.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { MapSummary } from '../map-facts';
import { NO_FILTERS, type MapFilters } from '../map-lens';
import { SummaryStrip, type SummaryStripProps } from './SummaryStrip';
import { FIT } from './fit';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const summary: MapSummary = { phases: { done: 12, in_flight: 4, next: 3, later: 9 }, blocked: 5, needsPerson: 2, liveSessions: 1 };
const NOW = Date.parse('2026-09-30T18:00:00Z');
const SINCE_TEXT = { full: '11 finished, 1 worked on, 9 filed', lead: '11 finished, +2 more kinds', total: '21 items changed' };

const props = (over: Partial<SummaryStripProps> = {}): SummaryStripProps => ({
	summary,
	filters: NO_FILTERS,
	onTogglePhase: vi.fn(),
	onToggleNeedsPerson: vi.fn(),
	onToggleLive: vi.fn(),
	updatedAt: NOW,
	clock: () => NOW,
	...over,
});

const countOf = (container: Element, label: string): string | null =>
	Array.from(container.querySelectorAll('span')).find((span) => span.textContent === label)?.nextElementSibling?.textContent ?? null;

describe('SummaryStrip', () => {
	it('counts per phase, blocked, needs a person, and live sessions', () => {
		const { container } = render(<SummaryStrip {...props()} />);
		expect(countOf(container, 'Done')).toBe('12');
		expect(countOf(container, 'In flight')).toBe('4');
		expect(countOf(container, 'Next')).toBe('3');
		expect(countOf(container, 'Later')).toBe('9');
		expect(countOf(container, 'Blocked')).toBe('5');
		expect(countOf(container, 'Needs a person')).toBe('2');
		expect(countOf(container, 'Live sessions')).toBe('1');
	});

	it('draws with dashes and nothing to press while the first read is loading', () => {
		const { container, getAllByRole } = render(<SummaryStrip {...props({ summary: null, updatedAt: null })} />);
		expect(countOf(container, 'Done')).toBe('-');
		for (const button of getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(container.textContent).not.toContain('Updated');
	});

	it('turns the counts that name a filter into toggles, and shows which are on', () => {
		const onTogglePhase = vi.fn();
		const onToggleNeedsPerson = vi.fn();
		const onToggleLive = vi.fn();
		const filters: MapFilters = { ...NO_FILTERS, phases: new Set(['next']), live: true };
		const { getByRole } = render(<SummaryStrip {...props({ filters, onTogglePhase, onToggleNeedsPerson, onToggleLive })} />);
		const chip = (name: RegExp): HTMLElement => getByRole('button', { name });
		expect(chip(/^Next/).getAttribute('aria-pressed')).toBe('true');
		expect(chip(/^Done/).getAttribute('aria-pressed')).toBe('false');
		expect(chip(/^Live sessions/).getAttribute('aria-pressed')).toBe('true');
		expect(chip(/^Needs a person/).getAttribute('aria-pressed')).toBe('false');

		fireEvent.click(chip(/^In flight/));
		expect(onTogglePhase).toHaveBeenCalledWith('in_flight');
		fireEvent.click(chip(/^Needs a person/));
		expect(onToggleNeedsPerson).toHaveBeenCalledTimes(1);
		fireEvent.click(chip(/^Live sessions/));
		expect(onToggleLive).toHaveBeenCalledTimes(1);
	});

	it('does not offer Blocked as a filter, since it is not a phase', () => {
		const { queryByRole } = render(<SummaryStrip {...props()} />);
		expect(queryByRole('button', { name: /^Blocked/ })).toBeNull();
	});

	it('has a slot for the Agents at work button, after the live count', () => {
		const { getByText, container } = render(<SummaryStrip {...props({ agents: <button type="button">Agents at work</button> })} />);
		const live = getByText('Live sessions');
		const agents = getByText('Agents at work');
		expect(live.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(container.querySelectorAll('section')).toHaveLength(1);
	});

	it('says when the data last loaded, and keeps saying so as minutes pass', () => {
		vi.useFakeTimers();
		let now = NOW;
		const { container } = render(<SummaryStrip {...props({ clock: () => now })} />);
		expect(container.textContent).toContain('Updated just now');
		now += 4 * 60_000;
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(container.textContent).toContain('Updated 4 min ago');
	});

	it('says retrying once a refresh has failed', () => {
		const { container } = render(<SummaryStrip {...props({ updatedAt: NOW - 4 * 60_000, retrying: true })} />);
		expect(container.textContent).toContain('Updated 4 min ago, retrying');
	});

	it('says what changed since the last visit, and toggles the changes view', () => {
		const onToggle = vi.fn();
		const since = { date: 'Sep 19', text: SINCE_TEXT, open: false, onToggle };
		const { getByRole, rerender } = render(<SummaryStrip {...props({ since })} />);
		const chip = getByRole('button', { name: 'Since Sep 19: 11 finished, 1 worked on, 9 filed' });
		expect(chip.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(chip);
		expect(onToggle).toHaveBeenCalledTimes(1);

		rerender(<SummaryStrip {...props({ since: { ...since, open: true } })} />);
		expect(getByRole('button', { name: /^Since Sep 19/ }).getAttribute('aria-pressed')).toBe('true');
	});

	it('has no since summary when nothing is waiting', () => {
		const { container } = render(<SummaryStrip {...props()} />);
		expect(container.textContent).not.toContain('Since');
	});
});

/**
 * jsdom does no layout, so the strip's box is faked: each character of its text is 8 px, and
 * the strip is as wide as the test says. That makes the yield order checkable at the width
 * where each step becomes necessary.
 */
describe('SummaryStrip when it runs out of room', () => {
	const CHAR = 8;
	let width = 10_000;
	let observed: (() => void) | null = null;

	beforeEach(() => {
		width = 10_000;
		observed = null;
		const measure = (element: Element): number => (element.tagName === 'SECTION' ? element.textContent!.length * CHAR : 0);
		Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return Math.max(measure(this), width); } });
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
		vi.stubGlobal('ResizeObserver', class {
			constructor(callback: () => void) {
				observed = callback;
			}
			observe(): void {}
			disconnect(): void {}
		});
	});

	afterEach(() => {
		delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
		delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
		vi.unstubAllGlobals();
	});

	const since = { date: 'Sep 23', text: SINCE_TEXT, open: false, onToggle: vi.fn() };
	const announce = { on: true, onToggle: vi.fn() };
	const agents = <button type="button">Agents at work</button>;
	const full = (): SummaryStripProps => props({ since, announce, agents });

	const strip = (container: Element): HTMLElement => container.querySelector('section')!;
	const wraps = (container: Element): boolean => strip(container).className.includes('wrap');
	const has = (container: Element, text: string): boolean => strip(container).textContent!.includes(text);

	/** The text length of the strip once it has yielded down to a level, from the strings each step swaps in. */
	const lengthAt = (level: number): number => {
		const natural = render(<SummaryStrip {...full()} />);
		const base = strip(natural.container).textContent!.length;
		natural.unmount();
		const steps = [
			SINCE_TEXT.lead.length - SINCE_TEXT.full.length,
			SINCE_TEXT.total.length - SINCE_TEXT.lead.length,
			'Updated now'.length - 'Updated just now'.length,
			-'Announce changesOn'.length,
		];
		return steps.slice(0, level).reduce((sum, step) => sum + step, base);
	};

	it('keeps every word while it fits', () => {
		const { container } = render(<SummaryStrip {...full()} />);
		expect(has(container, 'Since Sep 23: 11 finished, 1 worked on, 9 filed')).toBe(true);
		expect(has(container, 'Updated just now')).toBe(true);
		expect(has(container, 'Announce changesOn')).toBe(true);
		expect(wraps(container)).toBe(false);
	});

	const SHOWS: Array<[string, number, (c: Element) => void]> = [
		['shortens the since summary to its lead kind first', FIT.sinceLead, (c) => {
			expect(has(c, 'Since Sep 23: 11 finished, +2 more kinds')).toBe(true);
			expect(has(c, 'Updated just now')).toBe(true);
			expect(has(c, 'Announce changesOn')).toBe(true);
		}],
		['then to a count of items', FIT.sinceTotal, (c) => {
			expect(has(c, 'Since Sep 23: 21 items changed')).toBe(true);
			expect(has(c, 'Updated just now')).toBe(true);
			expect(has(c, 'Announce changesOn')).toBe(true);
		}],
		['then shortens the freshness note', FIT.freshShort, (c) => {
			expect(has(c, 'Since Sep 23: 21 items changed')).toBe(true);
			expect(has(c, 'Updated now')).toBe(true);
			expect(has(c, 'Announce changesOn')).toBe(true);
		}],
		['then collapses the announce switch to its icon, which keeps its name', FIT.announceIcon, (c) => {
			expect(has(c, 'Updated now')).toBe(true);
			expect(has(c, 'Announce')).toBe(false);
			expect(c.querySelector('button[aria-label="Announce changes"]')!.getAttribute('aria-pressed')).toBe('true');
			expect(wraps(c)).toBe(false);
		}],
	];

	for (const [name, level, check] of SHOWS) {
		it(name, () => {
			const fitted = lengthAt(level) * CHAR;
			const { container } = render(<SummaryStrip {...full()} />);
			width = fitted;
			act(() => observed?.());
			check(container);
		});
	}

	it('wraps only once everything else has yielded', () => {
		const tooNarrow = (lengthAt(FIT.announceIcon) - 1) * CHAR;
		const { container } = render(<SummaryStrip {...full()} />);
		width = tooNarrow;
		act(() => observed?.());
		expect(wraps(container)).toBe(true);
		expect(has(container, 'Since Sep 23: 21 items changed')).toBe(true);
		expect(has(container, 'Updated now')).toBe(true);
	});

	it('never drops a phase word, Blocked, Needs a person, or Live sessions, at any width', () => {
		const { container } = render(<SummaryStrip {...full()} />);
		for (const cells of [10_000, 600, 300, 100, 1]) {
			width = cells;
			act(() => observed?.());
			for (const word of ['Done', 'In flight', 'Next', 'Later', 'Blocked', 'Needs a person', 'Live sessions', 'Agents at work']) {
				expect(has(container, word), `${word} at ${cells}`).toBe(true);
			}
		}
	});

	it('gives the words back when the room returns', () => {
		const { container } = render(<SummaryStrip {...full()} />);
		width = 200;
		act(() => observed?.());
		expect(wraps(container)).toBe(true);
		width = 10_000;
		act(() => observed?.());
		expect(wraps(container)).toBe(false);
		expect(has(container, 'Since Sep 23: 11 finished, 1 worked on, 9 filed')).toBe(true);
		expect(has(container, 'Updated just now')).toBe(true);
		expect(has(container, 'Announce changesOn')).toBe(true);
	});

	it('shortens the freshness note first when there is no since summary', () => {
		const { container } = render(<SummaryStrip {...props({ announce, agents })} />);
		const natural = strip(container).textContent!.length;
		width = (natural - 1) * CHAR;
		act(() => observed?.());
		expect(has(container, 'Updated now')).toBe(true);
		expect(has(container, 'Announce changesOn')).toBe(true);
		expect(wraps(container)).toBe(false);
	});

	it('has nothing to yield but the wrap when there is only the counts', () => {
		const { container } = render(<SummaryStrip {...props({ updatedAt: null })} />);
		width = 100;
		act(() => observed?.());
		expect(wraps(container)).toBe(true);
		expect(has(container, 'Live sessions')).toBe(true);
	});
});
