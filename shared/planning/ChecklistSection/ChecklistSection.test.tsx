/**
 * ChecklistSection - an item's scratch todos
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/preact';
import { ChecklistSection } from './ChecklistSection';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: (...args: unknown[]) => put(...args),
		delete: (...args: unknown[]) => del(...args),
	},
}));

interface EntryPayload {
	id: string;
	text: string;
	status: 'todo' | 'done';
}

function entry(overrides: Partial<EntryPayload> = {}): EntryPayload {
	return { id: 'c1', text: 'Rename the column', status: 'todo', ...overrides };
}

const URL = '/api/projects/specboard/items/SB-12/checklist';

function renderSection(entries: EntryPayload[]): ReturnType<typeof render> {
	get.mockResolvedValue(entries);
	return render(<ChecklistSection projectSlug="specboard" itemKey="SB-12" />);
}

/** The section under an ancestor that closes on Escape, the way the drawer wraps it. */
function renderInDrawer(
	entries: EntryPayload[],
	onKeyDown: (e: KeyboardEvent) => void
): ReturnType<typeof render> {
	get.mockResolvedValue(entries);
	return render(
		<div onKeyDown={onKeyDown}>
			<ChecklistSection projectSlug="specboard" itemKey="SB-12" />
		</div>
	);
}

function boxes(container: Element): HTMLInputElement[] {
	return Array.from(container.querySelectorAll('input[type="checkbox"]'));
}

function draftField(container: Element): HTMLInputElement {
	const field = container.querySelector('input[aria-label="Add a checklist item"]');
	if (!(field instanceof HTMLInputElement)) {
		throw new Error('No draft field in the rendered ChecklistSection');
	}
	return field;
}

describe('ChecklistSection', () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
		put.mockReset();
		del.mockReset();
	});

	it('renders entries with their status', async () => {
		const { container, findByText } = renderSection([
			entry({ id: 'c1', text: 'Rename the column', status: 'done' }),
			entry({ id: 'c2', text: 'Check the migration', status: 'todo' }),
		]);

		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2));
		expect(boxes(container).map((box) => box.checked)).toEqual([true, false]);
		const texts = Array.from(container.querySelectorAll('[role="listitem"] input[type="text"]')).map(
			(el) => (el as HTMLInputElement).value
		);
		expect(texts).toEqual(['Rename the column', 'Check the migration']);
		expect(await findByText('Checklist (1/2)')).toBeTruthy();
	});

	it('shows the placeholder with no entries', async () => {
		const { findByText } = renderSection([]);

		expect(await findByText('Nothing on the checklist')).toBeTruthy();
		// No counts to report, so the heading carries none.
		expect(await findByText('Checklist')).toBeTruthy();
	});

	it('ticks the box before the write lands', async () => {
		const { container } = renderSection([entry({ status: 'todo' })]);
		await waitFor(() => expect(boxes(container)).toHaveLength(1));

		let release: (value: EntryPayload) => void = () => {};
		put.mockReturnValue(new Promise<EntryPayload>((resolve) => {
			release = resolve;
		}));

		fireEvent.click(boxes(container)[0] as HTMLInputElement);

		await waitFor(() => expect(boxes(container)[0]?.checked).toBe(true));
		expect(put).toHaveBeenCalledTimes(1);
		const [url, body] = put.mock.calls[0] as [string, Record<string, unknown>];
		expect(url).toBe(`${URL}/c1`);
		// toEqual, not toMatchObject: a stale `text` riding along is the whole bug.
		expect(body).toEqual({ status: 'done' });

		release(entry({ status: 'done' }));
	});

	it('reverts the box and reports the failure when the toggle write rejects', async () => {
		const { container, findByText } = renderSection([entry({ status: 'todo' })]);
		await waitFor(() => expect(boxes(container)).toHaveLength(1));
		put.mockRejectedValue(new Error('nope'));

		fireEvent.click(boxes(container)[0] as HTMLInputElement);

		expect(await findByText('Could not save that item.')).toBeTruthy();
		expect(boxes(container)[0]?.checked).toBe(false);
	});

	it('appends the entry on Enter and clears the draft', async () => {
		const { container } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));
		post.mockResolvedValue(entry({ id: 'new', text: 'Delete the dead branch' }));

		const field = draftField(container);
		fireEvent.input(field, { target: { value: 'Delete the dead branch' } });
		fireEvent.keyDown(field, { key: 'Enter' });

		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
		expect(url).toBe(URL);
		expect(body).toMatchObject({ text: 'Delete the dead branch' });
		// Re-query: rendering the first row replaces the empty-state node, and Preact
		// rebuilds the draft field alongside it.
		await waitFor(() => expect(draftField(container).value).toBe(''));
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
	});

	it('does not post twice when Enter is pressed again mid-request', async () => {
		const { container } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));

		let release: (value: EntryPayload) => void = () => {};
		post.mockReturnValue(new Promise<EntryPayload>((resolve) => {
			release = resolve;
		}));

		const field = draftField(container);
		fireEvent.input(field, { target: { value: 'Delete the dead branch' } });
		fireEvent.keyDown(field, { key: 'Enter' });
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		fireEvent.keyDown(draftField(container), { key: 'Enter' });
		release(entry({ id: 'new', text: 'Delete the dead branch' }));

		await waitFor(() => expect(draftField(container).value).toBe(''));
		expect(post).toHaveBeenCalledTimes(1);
	});

	// The drawer that holds this section closes on Escape, so a half-typed entry
	// would go down with the panel if the key kept bubbling.
	it('clears the draft on Escape without reaching the drawer', async () => {
		const onAncestorKeyDown = vi.fn();
		const { container } = renderInDrawer([], onAncestorKeyDown);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));

		const field = draftField(container);
		fireEvent.input(field, { target: { value: 'Half-typed' } });
		fireEvent.keyDown(field, { key: 'Escape' });

		await waitFor(() => expect(draftField(container).value).toBe(''));
		expect(onAncestorKeyDown).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});

	// Nothing left to dismiss, so Escape belongs to the drawer.
	it('lets Escape through when the draft is already empty', async () => {
		const onAncestorKeyDown = vi.fn();
		const { container } = renderInDrawer([], onAncestorKeyDown);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));

		fireEvent.keyDown(draftField(container), { key: 'Escape' });

		expect(onAncestorKeyDown).toHaveBeenCalledTimes(1);
	});

	it('renames an entry on blur', async () => {
		const { container } = renderSection([entry({ text: 'Rename the column' })]);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
		put.mockResolvedValue(entry({ text: 'Rename the status column' }));

		const field = container.querySelector('[role="listitem"] input[type="text"]') as HTMLInputElement;
		fireEvent.input(field, { target: { value: 'Rename the status column' } });
		fireEvent.blur(field);

		await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
		const [url, body] = put.mock.calls[0] as [string, Record<string, unknown>];
		expect(url).toBe(`${URL}/c1`);
		expect(body).toEqual({ text: 'Rename the status column' });
	});

	// Blanking the field is not a delete, and a rename to the same text is not an edit.
	it('writes nothing when the field is blanked or unchanged', async () => {
		const { container } = renderSection([entry({ text: 'Rename the column' })]);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));

		const field = container.querySelector('[role="listitem"] input[type="text"]') as HTMLInputElement;
		fireEvent.input(field, { target: { value: '  ' } });
		fireEvent.blur(field);
		fireEvent.blur(field);

		expect(put).not.toHaveBeenCalled();
	});

	it('reverts an unsaved rename on Escape without reaching the drawer', async () => {
		const onAncestorKeyDown = vi.fn();
		const { container } = renderInDrawer([entry({ text: 'Rename the column' })], onAncestorKeyDown);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));

		const field = container.querySelector('[role="listitem"] input[type="text"]') as HTMLInputElement;
		fireEvent.input(field, { target: { value: 'Half-typed rename' } });
		fireEvent.keyDown(field, { key: 'Escape' });

		expect(onAncestorKeyDown).not.toHaveBeenCalled();
		await waitFor(() => {
			const current = container.querySelector('[role="listitem"] input[type="text"]') as HTMLInputElement;
			expect(current.value).toBe('Rename the column');
		});
		expect(put).not.toHaveBeenCalled();
	});

	it('removes an entry', async () => {
		const { container, getByText } = renderSection([entry({ id: 'c1' })]);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
		del.mockResolvedValue({ success: true });

		fireEvent.click(getByText('Remove'));

		await waitFor(() => expect(del).toHaveBeenCalledWith(`${URL}/c1`));
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(0));
	});

	it('reports a failed remove and keeps the entry', async () => {
		const { container, getByText, findByText } = renderSection([entry({ id: 'c1' })]);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
		del.mockRejectedValue(new Error('nope'));

		fireEvent.click(getByText('Remove'));

		expect(await findByText('Could not remove that item.')).toBeTruthy();
		expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1);
	});

	// A checklist that failed to load is not an empty checklist.
	it('shows an error instead of the placeholder when the fetch fails', async () => {
		get.mockRejectedValue(new Error('nope'));
		const { container, findByText } = render(<ChecklistSection projectSlug="specboard" itemKey="SB-12" />);

		expect(await findByText('Could not load the checklist.')).toBeTruthy();
		expect(container.textContent).not.toContain('Nothing on the checklist');
	});
});
