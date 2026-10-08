/**
 * Board columns — which statuses get one, and where they sit — and who may move the
 * cards in them: one project's editors, and nobody on a board over several projects.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/preact';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ItemsCollection, useModel, type ItemModel, type ItemStatus } from '@specboard/models';
import { MergedItems } from '../MultiProject/merged-items';
import { Board } from './Board';

const getResponse = vi.fn();

// The windowed list load is the only request a board makes on its own. Anything
// else is a test wiring mistake, and a throw names it instead of resolving to
// undefined and failing somewhere less obvious.
vi.mock('@specboard/fetch', async (importOriginal) => {
	const unexpected = (method: string): ReturnType<typeof vi.fn> => vi.fn((url: unknown) => {
		throw new Error(`Unexpected ${method} ${String(url)} in a board column test`);
	});
	return {
		...(await importOriginal<typeof import('@specboard/fetch')>()),
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

interface BoardTestProps {
	selectedItemKey?: string;
	onSelectItem?: (item: ItemModel | undefined) => void;
	onOpenItem?: (item: ItemModel) => void;
	canEdit?: boolean;
	onCreateItem?: () => void;
	onWriteError?: (err: unknown, fallback: string) => void;
}

async function renderBoard(
	counts: Partial<Record<ItemStatus, number>>,
	props: BoardTestProps = {}
): Promise<ReturnType<typeof render> & { items: ItemsCollection }> {
	serve(counts);
	const items = new ItemsCollection({ projectRef: 'acme/demo', limit: 100 });
	await items.fetch();
	const rendered = render(
		<Board
			items={items}
			selectedItemKey={props.selectedItemKey}
			flashingIds={new Set()}
			dialogOpen={false}
			canEdit={props.canEdit ?? true}
			onSelectItem={props.onSelectItem ?? vi.fn()}
			onOpenItem={props.onOpenItem ?? vi.fn()}
			onCreateItem={props.onCreateItem ?? vi.fn()}
			onWriteError={props.onWriteError ?? vi.fn()}
		/>
	);
	return { ...rendered, items };
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

describe('Board for someone who can\'t edit', () => {
	beforeEach(() => {
		getResponse.mockReset();
	});

	it('offers no drag and takes no drops', async () => {
		const { container, getByRole } = await renderBoard({ ready: 1, done: 1 }, { canEdit: false });

		for (const card of container.querySelectorAll('[data-item-card]')) {
			expect(card.getAttribute('draggable')).toBe('false');
		}
		const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
		getByRole('listbox', { name: 'Ready column' }).dispatchEvent(dragOver);
		expect(dragOver.defaultPrevented).toBe(false);
	});

	it('ignores the create and move shortcuts', async () => {
		const onCreateItem = vi.fn();
		const { items } = await renderBoard({ ready: 1 }, { canEdit: false, selectedItemKey: 'SB-ready-1', onCreateItem });
		const save = vi.spyOn(items[0]!, 'save');

		fireEvent.keyDown(document, { key: 'n' });
		fireEvent.keyDown(document, { key: '2' });

		expect(onCreateItem).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(items[0]!.status).toBe('ready');
	});
});

describe('Board keys', () => {
	beforeEach(() => {
		getResponse.mockReset();
	});

	/** A link and a control beside the board, as a page's toolbar and drawer have. */
	function elsewhere(): { link: HTMLElement; button: HTMLElement; drawer: HTMLElement; remove(): void } {
		const link = document.body.appendChild(document.createElement('a'));
		link.setAttribute('href', '/elsewhere');
		const button = document.body.appendChild(document.createElement('button'));
		const drawer = document.body.appendChild(document.createElement('div'));
		drawer.setAttribute('data-item-drawer', '');
		drawer.tabIndex = 0;
		return { link, button, drawer, remove: () => [link, button, drawer].forEach((element) => element.remove()) };
	}

	it('leaves the keys that follow a link or press a button to it, and every key aimed into the drawer', async () => {
		const onOpenItem = vi.fn();
		const onSelectItem = vi.fn();
		await renderBoard({ ready: 2 }, { selectedItemKey: 'SB-ready-1', onOpenItem, onSelectItem });
		const { link, button, drawer, remove } = elsewhere();

		// fireEvent answers false when a listener cancelled the key, which would stop Enter following the link.
		expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true);
		expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
		expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true);
		expect(fireEvent.keyDown(drawer, { key: 'ArrowDown' })).toBe(true);
		expect(fireEvent.keyDown(drawer, { key: 'Escape' })).toBe(true);
		expect(onOpenItem).not.toHaveBeenCalled();
		expect(onSelectItem).not.toHaveBeenCalled();

		// Aimed at the board, Enter is the board's.
		fireEvent.keyDown(document.body, { key: 'Enter' });
		expect(onOpenItem).toHaveBeenCalledTimes(1);
		remove();
	});

	it('takes its other keys from a focused link or button: the arrows, Escape, the shortcuts', async () => {
		const onSelectItem = vi.fn();
		const onCreateItem = vi.fn();
		await renderBoard({ ready: 2 }, { selectedItemKey: 'SB-ready-1', onSelectItem, onCreateItem });
		const { link, button, remove } = elsewhere();

		expect(fireEvent.keyDown(button, { key: 'ArrowDown' })).toBe(false);
		expect((onSelectItem.mock.calls.at(-1)?.[0] as ItemModel).key).toBe('SB-ready-2');
		fireEvent.keyDown(link, { key: 'Escape' });
		expect(onSelectItem).toHaveBeenLastCalledWith(undefined);
		fireEvent.keyDown(button, { key: 'n' });
		expect(onCreateItem).toHaveBeenCalledTimes(1);
		remove();
	});

	/** A board whose selection is its own to keep, as a page's is. */
	function SelectingBoard({ items, selected: initial, onOpenItem }: { items: ItemsCollection; selected?: string; onOpenItem: (item: ItemModel) => void }): JSX.Element {
		const [selected, setSelected] = useState<string | undefined>(initial);
		return <Board items={items} canEdit={false} selectedItemKey={selected} onSelectItem={(item) => setSelected(item?.key)} onOpenItem={onOpenItem} />;
	}

	async function renderSelecting(selected?: string): Promise<{ cards: HTMLElement[]; onOpenItem: ReturnType<typeof vi.fn> }> {
		serve({ ready: 3 });
		const items = new ItemsCollection({ projectRef: 'acme/demo', limit: 100 });
		await items.fetch();
		const onOpenItem = vi.fn();
		const { container } = render(<SelectingBoard items={items} selected={selected} onOpenItem={onOpenItem} />);
		return { cards: Array.from(container.querySelectorAll<HTMLElement>('[data-item-card]')), onOpenItem };
	}

	it('moves focus with the selection, so Enter opens the card the arrows landed on', async () => {
		const { cards, onOpenItem } = await renderSelecting();

		// A click selects a card and, as in a browser, focuses it; it opens it too.
		cards[0]!.focus();
		fireEvent.click(cards[0]!);
		onOpenItem.mockClear();

		fireEvent.keyDown(cards[0]!, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(cards[1]);
		await waitFor(() => expect(cards[1]!.getAttribute('aria-selected')).toBe('true'));

		fireEvent.keyDown(cards[1]!, { key: 'Enter' });
		expect(onOpenItem).toHaveBeenCalledTimes(1);
		expect((onOpenItem.mock.calls[0]?.[0] as ItemModel).key).toBe('SB-ready-2');
	});

	it('acts on the card focus is on, so the arrows move on from a card reached with Tab', async () => {
		const { cards } = await renderSelecting('SB-ready-1');

		cards[2]!.focus();
		fireEvent.keyDown(cards[2]!, { key: 'ArrowUp' });

		expect(document.activeElement).toBe(cards[1]);
		await waitFor(() => expect(cards[1]!.getAttribute('aria-selected')).toBe('true'));
	});

	it('leaves Enter on a card\'s own new-window button to the button', async () => {
		const onOpenItem = vi.fn();
		const { container } = await renderBoard({ ready: 1 }, { selectedItemKey: 'SB-ready-1', onOpenItem });
		const board: HTMLElement = container;
		const button = board.querySelector<HTMLElement>('[data-item-card] button[aria-label="Open in new window"]')!;

		expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
		expect(onOpenItem).not.toHaveBeenCalled();
	});
});

describe('Board over several projects', () => {
	const PROJECTS = new Map([
		['acme/one', { ref: 'acme/one', name: 'One', key: 'ONE' }],
		['acme/two', { ref: 'acme/two', name: 'Two', key: 'TWO' }],
	]);

	beforeEach(() => {
		getResponse.mockReset();
	});

	/** Two projects with two Ready items each, merged the way the multi-project view merges them. */
	async function renderMerged(onSelectItem = vi.fn()): Promise<{ view: ReturnType<typeof render>; items: MergedItems }> {
		getResponse.mockImplementation(async (url: string) => {
			const parsed = new URL(url, 'http://x');
			const key = parsed.pathname.includes('/acme/one/') ? 'ONE' : 'TWO';
			const data = parsed.searchParams.get('status') === 'ready'
				? [1, 2].map((n) => ({ id: `id-${key}-${n}`, key: `${key}-${n}`, status: 'ready', type: 'task', rank: n, title: `${key} ${n}`, updatedAt: 't1' }))
				: [];
			return { data, headers: new Headers({ 'X-Total-Count': String(data.length) }) };
		});
		const items = new MergedItems(['acme/one', 'acme/two'].map((projectRef) => new ItemsCollection({ projectRef, limit: 100 })));
		await items.fetch();
		const view = render(<Board items={items} canEdit={false} projects={PROJECTS} onSelectItem={onSelectItem} onOpenItem={vi.fn()} />);
		return { view, items };
	}

	it('mixes the projects in each column, every card naming its project', async () => {
		const { view } = await renderMerged();

		const column: HTMLElement = view.getByRole('listbox', { name: 'Ready column' });
		const cards = Array.from(column.querySelectorAll<HTMLElement>('[data-item-card]'));
		expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['ONE 1', 'TWO 1', 'ONE 2', 'TWO 2']);
		expect(cards.map((card) => card.querySelector('[title^="acme/"]')?.textContent)).toEqual(['One', 'Two', 'One', 'Two']);
	});

	it('names no project on a single project\'s board', async () => {
		const { container } = await renderBoard({ ready: 2 });
		expect(container.querySelector('[title="acme/demo"]')).toBeNull();
	});

	it('offers no drag and no moves, while the arrow keys still step through the cards', async () => {
		const onSelectItem = vi.fn();
		const { view, items } = await renderMerged(onSelectItem);
		const saves = items.byStatus('ready').map((item) => vi.spyOn(item, 'save'));

		for (const card of view.container.querySelectorAll('[data-item-card]')) {
			expect(card.getAttribute('draggable')).toBe('false');
		}
		const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
		view.getByRole('listbox', { name: 'Done column' }).dispatchEvent(dragOver);
		expect(dragOver.defaultPrevented).toBe(false);

		fireEvent.keyDown(document, { key: 'ArrowDown' });
		await waitFor(() => expect(onSelectItem).toHaveBeenCalledTimes(1));
		expect((onSelectItem.mock.calls[0]?.[0] as ItemModel).key).toBe('ONE-1');

		fireEvent.keyDown(document, { key: 'n' });
		fireEvent.keyDown(document, { key: '3' });
		for (const save of saves) expect(save).not.toHaveBeenCalled();
	});
});

describe('Board moves and focus', () => {
	beforeEach(() => {
		getResponse.mockReset();
	});

	/** A project's own board, keeping its selection and re-rendering on changes, as its page does. */
	function PageBoard({ items, selected: initial }: { items: ItemsCollection; selected?: string }): JSX.Element {
		useModel(items);
		const [selected, setSelected] = useState<string | undefined>(initial);
		return (
			<Board
				items={items}
				canEdit
				selectedItemKey={selected}
				onSelectItem={(item) => setSelected(item?.key)}
				onOpenItem={() => {}}
				onCreateItem={() => {}}
				onWriteError={() => {}}
			/>
		);
	}

	async function renderPage(selected?: string): Promise<{ items: ItemsCollection; card: (key: string) => HTMLElement }> {
		serve({ ready: 2 });
		const items = new ItemsCollection({ projectRef: 'acme/demo', limit: 100 });
		await items.fetch();
		for (const item of items.byStatus('ready')) vi.spyOn(item, 'save').mockResolvedValue(undefined);
		const { container } = render(<PageBoard items={items} selected={selected} />);
		return { items, card: (key) => container.querySelector<HTMLElement>(`[data-item-card][data-item-key="${key}"]`)! };
	}

	it('moves nothing on 1, 2, or 3 once Escape has cleared the selection, though the clicked card keeps focus', async () => {
		const { items, card } = await renderPage();
		const first = items.byStatus('ready')[0]!;

		// A click focuses the card, as a browser's does, and selects it.
		card(first.key).focus();
		fireEvent.click(card(first.key));
		fireEvent.keyDown(card(first.key), { key: 'Escape' });
		fireEvent.keyDown(card(first.key), { key: '3' });

		expect(first.save).not.toHaveBeenCalled();
		expect(first.status).toBe('ready');
	});

	it('gives focus back to a card the move keys took to another column', async () => {
		const { items, card } = await renderPage('SB-ready-1');
		const moved = items.byStatus('ready')[0]!;
		card('SB-ready-1').focus();

		fireEvent.keyDown(card('SB-ready-1'), { key: '2' });

		expect(moved.save).toHaveBeenCalled();
		expect(moved.status).toBe('in_progress');
		await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute('data-item-key')).toBe('SB-ready-1'));
		expect(document.activeElement!.closest('[role="listbox"]')!.getAttribute('aria-label')).toBe('In Progress column');
	});

	it('gives focus back to a card dropped in another column', async () => {
		const { card } = await renderPage('SB-ready-1');
		card('SB-ready-1').focus();

		fireEvent.drop(screen.getByRole('listbox', { name: 'Done column' }), { dataTransfer: { getData: () => 'id-ready-1' } });

		await waitFor(() => expect(document.activeElement!.closest('[role="listbox"]')?.getAttribute('aria-label')).toBe('Done column'));
		expect((document.activeElement as HTMLElement).getAttribute('data-item-key')).toBe('SB-ready-1');
	});
});

describe('Board refused moves', () => {
	beforeEach(() => {
		getResponse.mockReset();
	});

	it('puts the card back and reports the refusal', async () => {
		const onWriteError = vi.fn();
		const { items } = await renderBoard({ ready: 1 }, { selectedItemKey: 'SB-ready-1', onWriteError });
		const refusal = new Error('HTTP 403: Forbidden');
		vi.spyOn(items[0]!, 'save').mockRejectedValue(refusal);

		fireEvent.keyDown(document, { key: '2' });

		await waitFor(() => expect(onWriteError).toHaveBeenCalledWith(refusal, 'Could not move SB-ready-1.'));
		expect(items[0]!.status).toBe('ready');
		expect(items[0]!.rank).toBe(1);
	});
});
