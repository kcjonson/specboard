/**
 * The summary strip: counts, the counts that are filters, the slot for the roster button, and freshness.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { MapSummary } from '../map-facts';
import { NO_FILTERS, type MapFilters } from '../map-lens';
import { SummaryStrip, type SummaryStripProps } from './SummaryStrip';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const summary: MapSummary = { phases: { done: 12, in_flight: 4, next: 3, later: 9 }, blocked: 5, needsPerson: 2, liveSessions: 1 };
const NOW = Date.parse('2026-09-30T18:00:00Z');

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
});
