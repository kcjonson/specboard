/**
 * ItemDrawer before its item resolves: an item the board list doesn't hold must
 * not mount the editor (or its Delete) until its own fetch lands.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { ItemModel } from '@specboard/models';
import { ItemDrawer } from './ItemDrawer';

const get = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: {
			get: (...args: unknown[]) => get(...args),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		},
	};
});

// The sections fetch their own sub-resources and the picker loads Editor's
// slate-react; none of that is under test, only whether ItemView mounts at all.
vi.mock('../ChildrenSection/ChildrenSection', () => ({ ChildrenSection: () => null }));
vi.mock('../ChecklistSection/ChecklistSection', () => ({ ChecklistSection: () => null }));
vi.mock('../SpecsSection/SpecsSection', () => ({ SpecsSection: () => null }));
vi.mock('../BlockersSection/BlockersSection', () => ({ BlockersSection: () => null }));
vi.mock('../NotesSection/NotesSection', () => ({ NotesSection: () => null }));
vi.mock('@specboard/pages', () => ({ ItemPicker: () => null }));
vi.mock('../RichTextEditor', () => ({
	RichTextEditor: () => <div data-testid="description-editor" />,
	serializeToText: () => '',
	deserializeFromText: () => [],
}));

const KEY = 'SPE-9999';

/** Built the way Planning builds a standalone model, so its constructor starts the fetch. */
function unlistedItem(): ItemModel {
	return new ItemModel({ key: KEY, projectSlug: 'specboard' });
}

function renderDrawer(item: ItemModel, listed: boolean): ReturnType<typeof render> {
	return render(<ItemDrawer item={item} listed={listed} projectSlug="specboard" onClose={vi.fn()} onDelete={vi.fn()} />);
}

function expectInert(view: ReturnType<typeof render>): void {
	expect(view.queryByRole('button', { name: /^Delete/ })).toBeNull();
	expect(view.queryByTestId('description-editor')).toBeNull();
	expect(view.queryByLabelText('Status')).toBeNull();
}

describe('ItemDrawer before the item resolves', () => {
	beforeEach(() => {
		get.mockReset();
		// In flight until a test says otherwise.
		get.mockReturnValue(new Promise(() => {}));
	});

	it('renders no editor and no Delete while the fetch is in flight', () => {
		const view = renderDrawer(unlistedItem(), false);

		expectInert(view);
		expect(view.getByText('Loading...')).toBeTruthy();
		// No type yet, so the header can't claim one.
		expect(view.getByRole('heading', { level: 2 }).textContent).toBe(KEY);
		expect(view.queryByRole('button', { name: 'Open in new window' })).toBeNull();
	});

	it('mounts the editor once the fetch lands', async () => {
		let land: (data: unknown) => void = () => {};
		get.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
		const view = renderDrawer(unlistedItem(), false);
		expectInert(view);

		await act(async () => {
			land({ key: KEY, projectSlug: 'specboard', title: 'Found', type: 'task', status: 'ready' });
		});

		expect(view.getByRole('button', { name: 'Delete Task' })).toBeTruthy();
		expect(view.getByTestId('description-editor')).toBeTruthy();
		expect(view.getByRole('heading', { level: 2 }).textContent).toBe(`${KEY} · Task`);
	});

	// The constructor's own fetch has no handler, so a rejection there would surface
	// as an unhandled error in the run; a second load drives the same first-load state.
	async function failLoad(item: ItemModel, error: Error): Promise<void> {
		get.mockRejectedValueOnce(error);
		await act(async () => {
			await item.fetch().catch(() => undefined);
		});
	}

	it('stays inert and says the item is gone on a 404', async () => {
		const item = unlistedItem();
		const view = renderDrawer(item, false);
		await failLoad(item, new FetchError('HTTP 404: Not Found', 404));

		expectInert(view);
		expect(view.getByText(`${KEY} couldn't be found. It may have been deleted, or the link may be wrong.`)).toBeTruthy();
	});

	it('stays inert without claiming the item is gone on any other failure', async () => {
		const item = unlistedItem();
		const view = renderDrawer(item, false);
		await failLoad(item, new FetchError('HTTP 500: Internal Server Error', 500));

		expectInert(view);
		expect(view.getByText(`${KEY} couldn't be loaded. Close this and try again.`)).toBeTruthy();
	});

	// A row from the board list exists already; waiting on its detail fetch would
	// flash a placeholder over data that is on screen.
	it('mounts the editor at once for an item from the board list', () => {
		const item = new ItemModel({ key: 'SPE-1', projectSlug: 'specboard', title: 'Listed', type: 'epic', status: 'ready' });
		const view = renderDrawer(item, true);

		expect(item.$meta.lastFetched).toBeNull();
		expect(view.queryByText('Loading...')).toBeNull();
		expect(view.getByRole('button', { name: 'Delete Epic' })).toBeTruthy();
		expect(view.getByTestId('description-editor')).toBeTruthy();
	});
});
