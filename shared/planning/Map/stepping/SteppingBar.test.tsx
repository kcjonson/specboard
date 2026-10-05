/**
 * The stepping bar: search matches and the changes view step through their lists with it.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import type { SteppingBarProps } from './SteppingBar';
import { SteppingBar } from './SteppingBar';

afterEach(cleanup);

const props = (over: Partial<SteppingBarProps> = {}): SteppingBarProps => ({
	title: 'Matches for "checklist"',
	keys: ['A-1', 'A-2', 'A-3'],
	unit: ['match', 'matches'],
	empty: 'No matches',
	onStep: vi.fn(),
	onClose: vi.fn(),
	closeLabel: 'Clear',
	...over,
});

describe('SteppingBar', () => {
	it('reads the title and a count before the first step', () => {
		const { getByRole, getByText } = render(<SteppingBar {...props()} />);
		expect(getByRole('region').getAttribute('aria-label')).toBe('Matches for "checklist"');
		expect(getByText('Matches for "checklist"')).toBeTruthy();
		expect(getByRole('status').textContent).toBe('3 matches');
	});

	it('steps in order with the arrows, reading "2 of 3", and wraps around', () => {
		const onStep = vi.fn();
		const { getByRole, getByLabelText } = render(<SteppingBar {...props({ onStep })} />);
		const next = getByLabelText('Next');
		const previous = getByLabelText('Previous');
		fireEvent.click(next);
		expect(getByRole('status').textContent).toBe('1 of 3');
		fireEvent.click(next);
		fireEvent.click(next);
		expect(getByRole('status').textContent).toBe('3 of 3');
		fireEvent.click(next);
		expect(getByRole('status').textContent).toBe('1 of 3');
		fireEvent.click(previous);
		expect(getByRole('status').textContent).toBe('3 of 3');
		expect(onStep.mock.calls.map(([key]) => key)).toEqual(['A-1', 'A-2', 'A-3', 'A-1', 'A-3']);
	});

	it('steps back from the last item when the first step is backward', () => {
		const onStep = vi.fn();
		const { getByLabelText } = render(<SteppingBar {...props({ onStep })} />);
		fireEvent.click(getByLabelText('Previous'));
		expect(onStep).toHaveBeenCalledWith('A-3');
	});

	it('steps on ] and [ the way the arrows do', () => {
		const onStep = vi.fn();
		render(<SteppingBar {...props({ onStep })} />);
		fireEvent.keyDown(document.body, { key: ']' });
		fireEvent.keyDown(document.body, { key: ']' });
		fireEvent.keyDown(document.body, { key: '[' });
		expect(onStep.mock.calls.map(([key]) => key)).toEqual(['A-1', 'A-2', 'A-1']);
	});

	it('leaves ] and [ to a field that is being typed in, and to a held modifier', () => {
		const onStep = vi.fn();
		render(<SteppingBar {...props({ onStep })} />);
		const input = document.createElement('input');
		document.body.appendChild(input);
		fireEvent.keyDown(input, { key: ']' });
		input.remove();
		fireEvent.keyDown(document.body, { key: ']', metaKey: true });
		fireEvent.keyDown(document.body, { key: ']', ctrlKey: true });
		expect(onStep).not.toHaveBeenCalled();
	});

	it('keeps its place when the list changes under it and the item is still in it, and starts over when it is not', () => {
		const onStep = vi.fn();
		const { getByRole, getByLabelText, rerender } = render(<SteppingBar {...props({ onStep })} />);
		fireEvent.click(getByLabelText('Next'));
		fireEvent.click(getByLabelText('Next'));
		expect(getByRole('status').textContent).toBe('2 of 3');
		rerender(<SteppingBar {...props({ onStep, keys: ['A-0', 'A-2', 'A-3'] })} />);
		expect(getByRole('status').textContent).toBe('2 of 3');
		rerender(<SteppingBar {...props({ onStep, keys: ['B-1', 'B-2'] })} />);
		expect(getByRole('status').textContent).toBe('2 matches');
	});

	it('says there is nothing in the bar when nothing matched, and has no steps to offer', () => {
		const onStep = vi.fn();
		const { getByRole, queryByLabelText } = render(<SteppingBar {...props({ keys: [], onStep })} />);
		expect(getByRole('status').textContent).toBe('No matches');
		expect(queryByLabelText('Next')).toBeNull();
		expect(queryByLabelText('Previous')).toBeNull();
		fireEvent.keyDown(document.body, { key: ']' });
		expect(onStep).not.toHaveBeenCalled();
	});

	it('waits while an answer is on its way, and offers an action when it has failed', () => {
		const onStep = vi.fn();
		const retry = vi.fn();
		const { getByRole, getByLabelText, getByText, rerender } = render(<SteppingBar {...props({ onStep, busy: true })} />);
		expect(getByRole('status').textContent).toBe('Searching...');
		expect((getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.keyDown(document.body, { key: ']' });
		expect(onStep).not.toHaveBeenCalled();

		rerender(<SteppingBar {...props({ keys: [], empty: 'Search failed', action: { label: 'Retry', onClick: retry } })} />);
		fireEvent.click(getByText('Retry'));
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it('closes from its button, and stops listening for keys when it is gone', () => {
		const onStep = vi.fn();
		const onClose = vi.fn();
		const { getByText, unmount } = render(<SteppingBar {...props({ onStep, onClose, closeLabel: 'Mark all seen' })} />);
		fireEvent.click(getByText('Mark all seen'));
		expect(onClose).toHaveBeenCalledTimes(1);
		unmount();
		fireEvent.keyDown(document.body, { key: ']' });
		expect(onStep).not.toHaveBeenCalled();
	});

	it('offers an accept button beside close, which does its own thing', () => {
		const onClose = vi.fn();
		const accept = vi.fn();
		const { getByText } = render(<SteppingBar {...props({ onClose, closeLabel: 'Close', accept: { label: 'Mark all seen', onClick: accept } })} />);
		fireEvent.click(getByText('Mark all seen'));
		expect(accept).toHaveBeenCalledTimes(1);
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(getByText('Close'));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
