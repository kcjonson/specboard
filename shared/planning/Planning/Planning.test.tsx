/**
 * Planning — what the page does when the items collection fails to load.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { Planning } from './Planning';

const getResponse = vi.fn();

// The header fetches the user and project name through `get`; the collection
// pages items through `getResponse`. Only the latter is under test, so `get`
// resolves to nothing and the real FetchError comes along for the status check.
vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: {
			get: vi.fn(() => Promise.resolve({})),
			getResponse: (...args: unknown[]) => getResponse(...args),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		},
	};
});

vi.mock('../Board/Board', () => ({ Board: () => <div data-testid="board" />, BOARD_PAGE_SIZE: 20 }));
vi.mock('../Table/Table', () => ({ Table: () => <div data-testid="table" />, TABLE_PAGE_SIZE: 50 }));
vi.mock('../ItemDrawer/ItemDrawer', () => ({ ItemDrawer: () => null, MissingItemDrawer: () => null }));
vi.mock('../NewItemDialog/NewItemDialog', () => ({ NewItemDialog: () => null }));

function failWith(error: Error): void {
	getResponse.mockRejectedValue(error);
}

function succeedEmpty(): void {
	getResponse.mockResolvedValue({ data: [], headers: new Headers() });
}

function renderPlanning(): ReturnType<typeof render> {
	return render(<Planning params={{ projectSlug: 'specboard' }} />);
}

describe('Planning load failures', () => {
	beforeEach(() => {
		getResponse.mockReset();
		window.history.replaceState({}, '', '/projects/specboard/planning');
	});

	it('keeps the toolbar and shows the error where the board goes', async () => {
		failWith(new FetchError('HTTP 500: Internal Server Error', 500));
		const { container, findByRole, queryByTestId } = renderPlanning();

		const alert = await findByRole('alert');
		expect(alert.textContent).toBe('Error: HTTP 500: Internal Server Error');
		expect(container.querySelector('input[type="search"]')).not.toBeNull();
		expect(queryByTestId('board')).toBeNull();
	});

	it('offers sign-in when the session has expired', async () => {
		failWith(new FetchError('HTTP 401: Unauthorized', 401));
		const { findByRole } = renderPlanning();

		const alert = await findByRole('alert');
		expect(alert.textContent).toContain('Your session has expired');
		expect(await findByRole('button', { name: 'Sign in' })).toBeTruthy();
	});

	// The collection clears its error when a fetch starts, so the focus refetch is
	// the recovery path; nothing on the page has to be remounted for it.
	it('renders the board again once a refetch succeeds', async () => {
		failWith(new FetchError('HTTP 500: Internal Server Error', 500));
		const { findByRole, findByTestId, queryByRole } = renderPlanning();
		await findByRole('alert');

		succeedEmpty();
		fireEvent(window, new Event('focus'));

		expect(await findByTestId('board')).toBeTruthy();
		await waitFor(() => expect(queryByRole('alert')).toBeNull());
	});
});
