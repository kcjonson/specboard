/**
 * ViewToggle
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { ViewToggle } from './ViewToggle';

afterEach(cleanup);

describe('ViewToggle', () => {
	it('offers Board, Table, and Map on a desktop width', () => {
		const { getAllByRole } = render(<ViewToggle view="board" onChange={() => {}} mapAvailable />);
		expect(getAllByRole('button').map((b) => b.textContent)).toEqual(['Board', 'Table', 'Map']);
	});

	it('offers only Board and Table below 768 px', () => {
		const { getAllByRole, queryByRole } = render(<ViewToggle view="board" onChange={() => {}} mapAvailable={false} />);
		expect(getAllByRole('button').map((b) => b.textContent)).toEqual(['Board', 'Table']);
		expect(queryByRole('button', { name: 'Map' })).toBeNull();
	});

	it('marks the current view pressed', () => {
		const { getByRole } = render(<ViewToggle view="map" onChange={() => {}} mapAvailable />);
		expect(getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('true');
		expect(getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('reports the view that was picked', () => {
		const onChange = vi.fn();
		const { getByRole } = render(<ViewToggle view="board" onChange={onChange} mapAvailable />);
		fireEvent.click(getByRole('button', { name: 'Map' }));
		expect(onChange).toHaveBeenCalledWith('map');
	});
});
