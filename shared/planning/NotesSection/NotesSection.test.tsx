/**
 * NotesSection - the item activity log
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/preact';
import { NotesSection } from './NotesSection';

const get = vi.fn();
const post = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

interface NotePayload {
	id: string;
	note: string;
	actor: { type: string; deviceName?: string; client?: { name: string } } | null;
	createdAt: string;
}

function note(overrides: Partial<NotePayload> = {}): NotePayload {
	return {
		id: 'n1',
		note: 'An entry',
		actor: null,
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

function renderSection(entries: NotePayload[]): ReturnType<typeof render> {
	get.mockResolvedValue(entries);
	return render(<NotesSection projectSlug="specboard" itemKey="SB-12" />);
}

const URL = '/api/projects/specboard/items/SB-12/notes';

describe('NotesSection', () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
	});

	it('renders entries in the order the server returns them', async () => {
		const { container } = renderSection([
			note({ id: 'n1', note: 'Newest' }),
			note({ id: 'n2', note: 'Older' }),
			note({ id: 'n3', note: 'Oldest' }),
		]);

		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(3));
		const texts = Array.from(container.querySelectorAll('[role="listitem"] p')).map(
			(el) => (el as Element).textContent
		);
		expect(texts).toEqual(['Newest', 'Older', 'Oldest']);
	});

	it('labels the actor when one is recorded', async () => {
		const { findByText } = renderSection([
			note({ actor: { type: 'agent', deviceName: 'studio', client: { name: 'Claude Code' } } }),
		]);

		expect(await findByText('Claude Code on studio')).toBeTruthy();
	});

	// Backfilled entries predate actor capture; they get no label rather than a
	// placeholder that reads like a real author.
	it('renders no actor label when the entry has none', async () => {
		const { container } = renderSection([note({ actor: null })]);

		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
		expect(container.textContent).not.toContain('Unknown');
		expect(container.querySelectorAll('[role="listitem"] span')).toHaveLength(1); // the time only
	});

	it('keeps multi-line entry text intact', async () => {
		const { container } = renderSection([note({ note: 'First line\nSecond line' })]);

		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));
		expect(container.querySelector('[role="listitem"] p')?.textContent).toBe('First line\nSecond line');
	});

	it('shows the empty state with no entries', async () => {
		const { findByText } = renderSection([]);

		expect(await findByText('No activity yet')).toBeTruthy();
	});

	it('posts the note on Enter and clears the input', async () => {
		const { container } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));
		post.mockResolvedValue(note({ id: 'new', note: 'Typed entry' }));

		const input = container.querySelector('input') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'Typed entry' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
		expect(url).toBe(URL);
		expect(body).toMatchObject({ note: 'Typed entry' });
		// Re-query: rendering the first entry replaces the empty-state node, and
		// Preact rebuilds the input alongside it.
		await waitFor(() =>
			expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
		);
	});

	it('puts the new entry first once the forced refetch lands', async () => {
		const { container } = renderSection([note({ id: 'n1', note: 'Older' })]);
		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1));

		post.mockResolvedValue(note({ id: 'new', note: 'Typed entry' }));
		// The server orders newest first; add() alone would leave the new entry last.
		get.mockResolvedValue([note({ id: 'new', note: 'Typed entry' }), note({ id: 'n1', note: 'Older' })]);

		const input = container.querySelector('input') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'Typed entry' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2));
		const texts = Array.from(container.querySelectorAll('[role="listitem"] p')).map(
			(el) => (el as Element).textContent
		);
		expect(texts).toEqual(['Typed entry', 'Older']);
	});

	it('does not post twice when Enter is pressed again mid-request', async () => {
		const { container } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));

		let release: (value: NotePayload) => void = () => {};
		post.mockReturnValue(new Promise<NotePayload>((resolve) => {
			release = resolve;
		}));

		const input = container.querySelector('input') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'Typed entry' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		fireEvent.keyDown(container.querySelector('input') as HTMLInputElement, { key: 'Enter' });
		release(note({ id: 'new', note: 'Typed entry' }));

		await waitFor(() => expect((container.querySelector('input') as HTMLInputElement).value).toBe(''));
		expect(post).toHaveBeenCalledTimes(1);
	});

	it('clears the draft on Escape', async () => {
		const { container } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));

		const input = container.querySelector('input') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'Half-typed' } });
		fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => expect((container.querySelector('input') as HTMLInputElement).value).toBe(''));
		expect(post).not.toHaveBeenCalled();
	});

	// A log that failed to load is not an empty log.
	it('shows an error instead of the empty state when the fetch fails', async () => {
		get.mockRejectedValue(new Error('nope'));
		const { container, findByText } = render(<NotesSection projectSlug="specboard" itemKey="SB-12" />);

		expect(await findByText('Could not load the activity log.')).toBeTruthy();
		expect(container.textContent).not.toContain('No activity yet');
	});

	it('reports a failed post and keeps the draft', async () => {
		const { container, findByText } = renderSection([]);
		await waitFor(() => expect(get).toHaveBeenCalledWith(URL));
		post.mockRejectedValue(new Error('nope'));

		const input = container.querySelector('input') as HTMLInputElement;
		fireEvent.input(input, { target: { value: 'Typed entry' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(await findByText('Could not add that note.')).toBeTruthy();
		expect((container.querySelector('input') as HTMLInputElement).value).toBe('Typed entry');
	});
});
