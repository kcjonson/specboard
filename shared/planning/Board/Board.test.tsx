/**
 * Board columns — which statuses get one, and where they sit.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { ItemsCollection, type ItemModel, type ItemStatus } from '@specboard/models';
import { Board } from './Board';

const getResponse = vi.fn();

// The windowed list load is the only request a board makes on its own. Anything
// else is a test wiring mistake, and a throw names it instead of resolving to
// undefined and failing somewhere less obvious.
vi.mock('@specboard/fetch', () => {
	const unexpected = (method: string): ReturnType<typeof vi.fn> => vi.fn((url: unknown) => {
		throw new Error(`Unexpected ${method} ${String(url)} in a board column test`);
	});
	return {
		fetchClient: {
			getResponse: (...args: unknown[]) => getResponse(...args),
			get: unexpected('GET'),
			post: unexpected('POST'),
			put: unexpected('PUT'),
			delete: unexpected('DELETE'),
		},
	};
});

/** One status window's worth of rows, paged the way the server pages them. */
function serve(counts: Partial<Record<ItemStatus, number>>): void {
	getResponse.mockImplementation(async (url: string) => {
		const params = new URL(url, 'http://x').searchParams;
		const status = params.get('status') as ItemStatus;
		const limit = Number(params.get('limit'));
		const total = counts[status] ?? 0;
		const data = Array.from({ length: Math.min(limit, total) }, (_, i) => ({
			id: `id-${status}-${i + 1}`,
			key: `SB-${status}-${i + 1}`,
			status,
			type: 'task',
			rank: i + 1,
			title: `${status} ${i + 1}`,
			updatedAt: 't1',
		}));
		return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
	});
}

async function renderBoard(
	counts: Partial<Record<ItemStatus, number>>,
	props: { selectedItemKey?: string; onSelectItem?: (item: ItemModel | undefined) => void } = {}
): Promise<ReturnType<typeof render>> {
	serve(counts);
	const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
	await items.fetch();
	return render(
		<Board
			items={items}
			projectSlug="demo"
			selectedItemKey={props.selectedItemKey}
			flashingIds={new Set()}
			dialogOpen={false}
			onSelectItem={props.onSelectItem ?? vi.fn()}
			onOpenItem={vi.fn()}
			onCreateItem={vi.fn()}
		/>
	);
}

function columnTitles(container: Element): string[] {
	return Array.from(container.querySelectorAll('h2')).map((el) => el.textContent ?? '');
}

describe('Board columns', () => {
	beforeEach(() => {
		getResponse.mockReset();
	});

	// The collection loads an in_review window like every other status; before this
	// the board had no column to put it in, so those items rendered nowhere.
	it('renders an In Review column between In Progress and Done', async () => {
		const { container, getByRole } = await renderBoard({ ready: 1, in_progress: 1, in_review: 1, done: 1 });

		expect(columnTitles(container)).toEqual(['Ready', 'In Progress', 'In Review', 'Done']);
		expect(getByRole('listbox', { name: 'In Review column' }).textContent).toContain('in_review 1');
	});

	it('leaves the In Review column out when nothing is in review', async () => {
		const { container, queryByRole } = await renderBoard({ ready: 1, done: 1 });

		expect(columnTitles(container)).toEqual(['Ready', 'In Progress', 'Done']);
		expect(queryByRole('listbox', { name: 'In Review column' })).toBeNull();
	});

	it('orders Blocked before In Review when both are held', async () => {
		const { container } = await renderBoard({ ready: 1, blocked: 1, in_review: 1 });

		expect(columnTitles(container)).toEqual(['Ready', 'In Progress', 'Blocked', 'In Review', 'Done']);
	});

	it('counts the In Review column from the server total', async () => {
		const { getByRole } = await renderBoard({ in_review: 1 });

		const header = getByRole('heading', { name: 'In Review' }).parentElement;
		expect(header?.textContent).toContain('1');
	});

	// Arrow keys walk the rendered columns, so a column the board grew has to be a
	// stop on the way rather than something selection jumps over.
	it('steps selection into the In Review column with the arrow keys', async () => {
		const onSelectItem = vi.fn();
		await renderBoard(
			{ in_progress: 1, in_review: 1 },
			{ selectedItemKey: 'SB-in_progress-1', onSelectItem }
		);

		fireEvent.keyDown(document, { key: 'ArrowRight' });

		await waitFor(() => expect(onSelectItem).toHaveBeenCalledTimes(1));
		expect((onSelectItem.mock.calls[0]?.[0] as ItemModel).key).toBe('SB-in_review-1');
	});

	// In Review is reached through the drawer, where the status carries its
	// sub-status with it; a drop writes status alone and would leave the two
	// disagreeing, so the column takes no drops (same as Blocked).
	it('takes no drops into In Review', async () => {
		const { getByRole } = await renderBoard({ in_review: 1, ready: 1 });

		const dropZone = getByRole('listbox', { name: 'In Review column' });
		const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
		dropZone.dispatchEvent(dragOver);

		expect(dragOver.defaultPrevented).toBe(false);
	});
});
