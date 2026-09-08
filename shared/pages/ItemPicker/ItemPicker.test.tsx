/**
 * ItemPicker — one server-side query per settled keystroke, and what a row does
 * when it's chosen.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { fetchClient } from '@specboard/fetch';
import { ItemPicker } from './ItemPicker';

vi.mock('@specboard/fetch', () => ({
	fetchClient: { get: vi.fn() },
}));

const get = vi.mocked(fetchClient.get);

const EPIC = { id: 'e-1', key: 'SB-4', title: 'UI Library', status: 'ready' };

/** Every request's URL, in order. */
function requested(): string[] {
	return get.mock.calls.map(([url]) => url as string);
}

function searchBox(container: Element): HTMLInputElement {
	const field = container.querySelector('input[type="search"]');
	if (!(field instanceof HTMLInputElement)) {
		throw new Error('No search input in the rendered ItemPicker');
	}
	return field;
}

/** Let the pending fetch resolve and its render land. */
async function settle(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

// Captured at module load, before anything is stubbed. Capturing inside beforeEach
// would save jsdom's originals on the first test and our own stubs on every one
// after, so the restore below would put the stubs back and leak them anyway.
const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
	// jsdom parses <dialog> but implements none of its methods, and the picker is
	// a modal. Enough of one for the element to reach the open state.
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
	vi.useFakeTimers();
	get.mockReset();
	get.mockResolvedValue([EPIC]);
});

afterEach(() => {
	vi.useRealTimers();
});

// Restored once, at the end, rather than per test: testing-library's auto-cleanup
// unmounts in its own afterEach, and Dialog closes itself on unmount. Putting these
// back between tests takes `close` away before that runs. Per-file is the isolation
// that matters here anyway — the leak worth preventing is into other files sharing
// this worker.
afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

describe('ItemPicker', () => {
	// A placeholder disappears on the first keystroke and is not a reliable label.
	it('gives the search field an accessible name', async () => {
		const { container } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();

		expect(searchBox(container).getAttribute('aria-label')).toBe('Choose a parent');
	});

	it('asks the server once per settled keystroke, not once per keystroke', async () => {
		const { container } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();
		expect(get).toHaveBeenCalledTimes(1);

		const box = searchBox(container);
		fireEvent.input(box, { target: { value: 'a' } });
		fireEvent.input(box, { target: { value: 'au' } });
		fireEvent.input(box, { target: { value: 'aut' } });
		await vi.advanceTimersByTimeAsync(100);
		expect(get).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(300);

		expect(get).toHaveBeenCalledTimes(2);
		expect(requested()[1]).toContain('search=aut');
	});

	it('settles an emptied box at once rather than waiting out the debounce', async () => {
		const { container } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();
		const box = searchBox(container);
		fireEvent.input(box, { target: { value: 'aut' } });
		await vi.advanceTimersByTimeAsync(300);

		fireEvent.input(box, { target: { value: '' } });
		await settle();

		expect(get).toHaveBeenCalledTimes(3);
		expect(requested()[2]).not.toContain('search=');
	});

	it('puts the type filter on the query string', async () => {
		render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" type="epic" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();

		expect(requested()[0]).toBe('/api/projects/specboard/items?limit=100&type=epic');
	});

	it('renders an empty state when nothing matched', async () => {
		get.mockResolvedValue([]);
		const { container } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();

		expect(container.textContent).toContain('No matching items');
	});

	// A retry that is still running is not a failure; leaving the old message up
	// makes every attempt after the first look like it failed instantly.
	it('drops a stale error as soon as the next search starts', async () => {
		get.mockRejectedValueOnce(new Error('offline'));
		const { container } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={vi.fn()} onClose={vi.fn()} />
		);
		await settle();
		expect(container.textContent).toContain('Could not load items.');

		// Held open, so the assertion lands while the retry is still in flight.
		let release: (rows: unknown[]) => void = () => {};
		get.mockReturnValue(new Promise<unknown[]>((resolve) => {
			release = resolve;
		}));
		fireEvent.input(searchBox(container), { target: { value: 'auth' } });
		// Past the debounce, so the fetch effect actually re-runs; settle() alone
		// advances by 0 and would leave the search unsettled.
		await vi.advanceTimersByTimeAsync(300);

		expect(container.textContent).not.toContain('Could not load items.');
		release([]);
	});

	it('hands the chosen row\'s key back', async () => {
		const onSelect = vi.fn();
		const { getByText } = render(
			<ItemPicker projectSlug="specboard" title="Choose a parent" onSelect={onSelect} onClose={vi.fn()} />
		);
		await settle();

		fireEvent.click(getByText('UI Library'));

		expect(onSelect).toHaveBeenCalledWith('SB-4');
	});

	it('offers the clear row only where one was given', async () => {
		const onSelect = vi.fn();
		const { getByText } = render(
			<ItemPicker
				projectSlug="specboard"
				title="Choose a parent"
				clearOption={{ label: 'No parent', onSelect }}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>
		);
		await settle();

		fireEvent.click(getByText('No parent'));

		expect(onSelect).toHaveBeenCalled();
	});
});
