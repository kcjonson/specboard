/**
 * Planning — what the page does when the items collection fails to load.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { memoryStorage } from '../test-support/memory-storage';
import { Planning } from './Planning';

const getResponse = vi.fn();
const get = vi.fn();
const post = vi.fn();

// The header fetches the user and the project through `get`; the collection pages
// items through `getResponse`. `get` answers with nothing unless a test serves a
// project, and the real FetchError comes along for the status check.
vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: {
			get: (...args: unknown[]) => get(...args),
			getResponse: (...args: unknown[]) => getResponse(...args),
			post: (...args: unknown[]) => post(...args),
			put: vi.fn(),
			delete: vi.fn(),
		},
	};
});

// Captured so a test can open items the way a card click does.
interface BoardStubProps {
	onOpenItem: (item: { key: string }) => void;
	onAssignToMe: (item: unknown) => void;
}
const board: { props?: BoardStubProps } = {};
vi.mock('../Board/Board', () => ({
	Board: (props: BoardStubProps) => {
		board.props = props;
		return <div data-testid="board" />;
	},
	BOARD_PAGE_SIZE: 20,
}));
vi.mock('../Table/Table', () => ({ Table: () => <div data-testid="table" />, TABLE_PAGE_SIZE: 50 }));
vi.mock('../Map/MapView', () => ({
	MapView: ({ openItemKey, covered, search, type, onClear }: { openItemKey?: string; covered: number; search: string; type: string | null; onClear(): void }) => (
		<div data-testid="map" data-open={openItemKey ?? ''} data-covered={covered} data-search={search} data-type={type ?? ''}>
			<button type="button" onClick={onClear}>Clear the Map</button>
		</div>
	),
}));
vi.mock('../ItemDrawer/ItemDrawer', async () => {
	const { useEffect } = await import('preact/hooks');
	return {
		ItemDrawer: ({ item, onResize, onClose }: { item: { key: string }; onResize?: (width: number) => void; onClose: () => void }) => {
			useEffect(() => onResize?.(420), [onResize]);
			return (
				<div data-testid="drawer" data-item={item.key}>
					<button type="button" onClick={onClose}>Close the drawer</button>
				</div>
			);
		},
	};
});
// Captured so a test can submit the create form without rendering a modal.
const newItemDialog: { props?: { onCreate: (data: { title: string }) => void } } = {};
vi.mock('../NewItemDialog/NewItemDialog', () => ({
	NewItemDialog: (props: { onCreate: (data: { title: string }) => void }) => {
		newItemDialog.props = props;
		return <div data-testid="new-item-dialog" />;
	},
}));

function failWith(error: Error): void {
	getResponse.mockRejectedValue(error);
}

function succeedEmpty(): void {
	getResponse.mockResolvedValue({ data: [], headers: new Headers() });
}

function renderPlanning(itemKey?: string, project = 'specboard'): ReturnType<typeof render> {
	return render(<Planning params={{ owner: 'acme', project, ...(itemKey ? { itemKey } : {}) }} />);
}

/** Answer the project read with the caller's roles; everything else `get` reads is empty. */
function serveProject(project: string, roles: { grantedRole: string; effectiveRole: string }): void {
	get.mockImplementation(async (url: string) => (url === `/api/projects/acme/${project}` ? { id: 'p1', name: 'Specboard', ...roles } : {}));
}

describe('Planning load failures', () => {
	beforeEach(() => {
		get.mockReset();
		get.mockResolvedValue({});
		getResponse.mockReset();
		window.history.replaceState({}, '', '/projects/acme/specboard/planning');
	});

	it('keeps the toolbar and shows the error where the board goes', async () => {
		failWith(new FetchError('HTTP 500: Internal Server Error', 500));
		const { container, findByRole, queryByTestId } = renderPlanning();

		const alert = await findByRole('alert');
		expect(alert.querySelector('p')?.textContent).toBe('Error: HTTP 500: Internal Server Error');
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

	// Automatic fetches are off while the collection holds an error, so Retry is the
	// recovery path; nothing on the page has to be remounted for it.
	it('renders the board again once Retry succeeds', async () => {
		failWith(new FetchError('HTTP 500: Internal Server Error', 500));
		const { findByRole, findByTestId, queryByRole } = renderPlanning();
		await findByRole('alert');

		succeedEmpty();
		fireEvent.click(await findByRole('button', { name: 'Retry' }));

		expect(await findByTestId('board')).toBeTruthy();
		await waitFor(() => expect(queryByRole('alert')).toBeNull());
	});

	// Refocusing a failed board must not retry on its own — that is how a rate limit
	// stays tripped.
	it('does not refetch on window focus while the error stands', async () => {
		failWith(new FetchError('HTTP 429: Too Many Requests', 429));
		const { findByRole } = renderPlanning();
		await findByRole('alert');

		const callsBefore = getResponse.mock.calls.length;
		fireEvent(window, new Event('focus'));
		// A fetch that did start would reach the client within a tick.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getResponse.mock.calls.length).toBe(callsBefore);
	});
});

describe('Planning views', () => {
	beforeEach(() => {
		get.mockReset();
		get.mockResolvedValue({});
	});

	/** Stands in for matchMedia, which jsdom lacks, at one width. */
	function setWidth(small: boolean): void {
		window.matchMedia = ((query: string) => ({
			matches: small && query.includes('768'),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		})) as unknown as typeof window.matchMedia;
	}

	beforeEach(() => {
		getResponse.mockReset();
		succeedEmpty();
		vi.stubGlobal('localStorage', memoryStorage());
		setWidth(false);
		window.history.replaceState({}, '', '/projects/acme/specboard/planning');
	});

	afterEach(() => {
		cleanup();
		delete (window as { matchMedia?: unknown }).matchMedia;
		vi.unstubAllGlobals();
	});

	it('offers Board, Table, and Map', async () => {
		const { findByTestId, getAllByRole } = renderPlanning();
		await findByTestId('board');
		const toggle = getAllByRole('group').find((group: HTMLElement) => group.getAttribute('aria-label') === 'View') as HTMLElement;
		expect(Array.from(toggle.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Board', 'Table', 'Map']);
	});

	it('loads the Map when it is picked, and remembers the pick', async () => {
		const { findByTestId, findByRole, queryByTestId } = renderPlanning();
		await findByTestId('board');

		fireEvent.click(await findByRole('button', { name: 'Map' }));
		expect(await findByTestId('map')).toBeTruthy();
		expect(queryByTestId('board')).toBeNull();
		expect(window.location.search).toBe('?view=map');
		expect(globalThis.localStorage.getItem('specboard.planning.view')).toBe('map');
	});

	it('opens on the Map from ?view=map', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { findByTestId, queryByTestId } = renderPlanning();
		expect(await findByTestId('map')).toBeTruthy();
		expect(queryByTestId('board')).toBeNull();
	});

	it('opens on the Map when it was the last view picked', async () => {
		globalThis.localStorage.setItem('specboard.planning.view', 'map');
		const { findByTestId } = renderPlanning();
		expect(await findByTestId('map')).toBeTruthy();
	});

	it('lands on the Board below 768 px, with no Map in the toggle', async () => {
		setWidth(true);
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { findByTestId, queryByTestId, queryByRole } = renderPlanning();
		expect(await findByTestId('board')).toBeTruthy();
		expect(queryByTestId('map')).toBeNull();
		expect(queryByRole('button', { name: 'Map' })).toBeNull();
		expect(queryByRole('button', { name: 'Table' })).not.toBeNull();
		// The request stays in the URL, so a wider window brings the Map back.
		expect(window.location.search).toBe('?view=map');
	});

	it('shows the Map even when the board failed to load', async () => {
		failWith(new FetchError('HTTP 500: Internal Server Error', 500));
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { findByTestId, queryByRole } = renderPlanning();
		expect(await findByTestId('map')).toBeTruthy();
		expect(queryByRole('alert')).toBeNull();
	});

	it('keeps the search box and the type filter on the Map, and hands the Map their settled values', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { container, findByTestId, findByRole } = renderPlanning();
		const map = await findByTestId('map');
		// The toolbar's copy, and the small-screen popover's, which CSS hides on desktop.
		expect(container.querySelectorAll('input[type="search"]').length).toBe(2);
		const box = container.querySelector('input[type="search"]') as HTMLInputElement;
		fireEvent.input(box, { target: { value: 'checklist' } });
		expect(map.getAttribute('data-search')).toBe('');
		await waitFor(() => expect(map.getAttribute('data-search')).toBe('checklist'));

		const select = container.querySelector('select') as HTMLSelectElement;
		fireEvent.change(select, { target: { value: 'bug' } });
		expect(map.getAttribute('data-type')).toBe('bug');

		fireEvent.click(await findByRole('button', { name: 'Clear the Map' }));
		await waitFor(() => expect(map.getAttribute('data-search')).toBe(''));
		expect(map.getAttribute('data-type')).toBe('');
		expect(box.value).toBe('');
	});

	it('leaves the board\'s own windows alone while the Map searches, and applies the search when the board returns', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { container, findByTestId, findByRole } = renderPlanning();
		await findByTestId('map');
		getResponse.mockClear();
		const box = container.querySelector('input[type="search"]') as HTMLInputElement;
		fireEvent.input(box, { target: { value: 'checklist' } });
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(getResponse).not.toHaveBeenCalled();

		fireEvent.click(await findByRole('button', { name: 'Board' }));
		await findByTestId('board');
		await waitFor(() => expect(getResponse.mock.calls.some(([url]) => String(url).includes('search=checklist'))).toBe(true));
	});

	it('drops a Map anchor when leaving for another view', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map&focus=SPE-4');
		const { findByTestId, findByRole } = renderPlanning();
		await findByTestId('map');
		fireEvent.click(await findByRole('button', { name: 'Board' }));
		expect(await findByTestId('board')).toBeTruthy();
		expect(window.location.search).toBe('?view=board');
	});

	it('has the drawer overlay the Map, and tells the Map the item and how much of it the drawer covers', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning/items/SPE-5?view=map');
		const { findByTestId } = renderPlanning('SPE-5');
		const drawer = await findByTestId('drawer');
		expect(drawer.parentElement!.className).toContain('drawerOverlay');
		const map = await findByTestId('map');
		expect(map.getAttribute('data-open')).toBe('SPE-5');
		await waitFor(() => expect(map.getAttribute('data-covered')).toBe('420'));
	});

	it('keeps the drawer beside the Board, where it narrows the view', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning/items/SPE-5?view=board');
		const { findByTestId } = renderPlanning('SPE-5');
		const drawer = await findByTestId('drawer');
		expect(drawer.parentElement!.className).toContain('drawerSlot');
	});

	it('tells the Map nothing is covered while no item is open', async () => {
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=map');
		const { findByTestId } = renderPlanning();
		const map = await findByTestId('map');
		expect(map.getAttribute('data-open')).toBe('');
		expect(map.getAttribute('data-covered')).toBe('0');
	});
});

describe('Planning drawer history', () => {
	beforeEach(() => {
		get.mockReset();
		get.mockResolvedValue({});
		getResponse.mockReset();
		succeedEmpty();
		vi.stubGlobal('localStorage', memoryStorage());
		// A push, so no entry an earlier test left ahead of this one counts toward the history length.
		window.history.pushState({}, '', '/projects/acme/specboard/planning?view=board');
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// Without the router here, each navigation's re-render with the new route is the test's own.
	it('opens an item as a new history entry, moves between items in place, and closes back to the board', async () => {
		const back = vi.spyOn(window.history, 'back');
		const { findByTestId, findByRole, rerender } = renderPlanning();
		await findByTestId('board');
		const before = window.history.length;

		act(() => board.props!.onOpenItem({ key: 'SPE-5' }));
		expect(window.location.pathname + window.location.search).toBe('/projects/acme/specboard/planning/items/SPE-5?view=board');
		expect(window.history.length).toBe(before + 1);
		rerender(<Planning params={{ owner: 'acme', project: 'specboard', itemKey: 'SPE-5' }} />);

		act(() => board.props!.onOpenItem({ key: 'SPE-6' }));
		expect(window.location.pathname).toBe('/projects/acme/specboard/planning/items/SPE-6');
		expect(window.history.length).toBe(before + 1);
		rerender(<Planning params={{ owner: 'acme', project: 'specboard', itemKey: 'SPE-6' }} />);
		expect((await findByTestId('drawer')).getAttribute('data-item')).toBe('SPE-6');

		fireEvent.click(await findByRole('button', { name: 'Close the drawer' }));
		expect(back).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/projects/acme/specboard/planning?view=board'));
	});

	it('closes in place after another view is picked with the drawer open, staying on that view', async () => {
		const back = vi.spyOn(window.history, 'back');
		const { findByTestId, findByRole, rerender } = renderPlanning();
		await findByTestId('board');

		act(() => board.props!.onOpenItem({ key: 'SPE-5' }));
		rerender(<Planning params={{ owner: 'acme', project: 'specboard', itemKey: 'SPE-5' }} />);
		fireEvent.click(await findByRole('button', { name: 'Table' }));
		expect(window.location.pathname + window.location.search).toBe('/projects/acme/specboard/planning/items/SPE-5?view=table');
		const length = window.history.length;

		fireEvent.click(await findByRole('button', { name: 'Close the drawer' }));
		expect(back).not.toHaveBeenCalled();
		expect(window.location.pathname + window.location.search).toBe('/projects/acme/specboard/planning?view=table');
		expect(window.history.length).toBe(length);
	});
});

describe('Planning for someone who can\'t edit', () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
		getResponse.mockReset();
		succeedEmpty();
		window.history.replaceState({}, '', '/projects/acme/specboard/planning');
	});

	it('offers no create button to a viewer', async () => {
		serveProject('viewing', { grantedRole: 'viewer', effectiveRole: 'viewer' });
		const { findByTestId, queryByRole } = renderPlanning(undefined, 'viewing');

		await findByTestId('board');
		await waitFor(() => expect(get).toHaveBeenCalledWith('/api/projects/acme/viewing'));
		expect(queryByRole('button', { name: /New/ })).toBeNull();
	});

	it('offers it once an editor\'s role has loaded', async () => {
		serveProject('editing', { grantedRole: 'editor', effectiveRole: 'editor' });
		const { findByRole } = renderPlanning(undefined, 'editing');

		expect(await findByRole('button', { name: /New/ })).toBeTruthy();
	});

	// The QA finding behind this: a refused create closed the dialog and said nothing.
	it('says why a create was refused instead of closing silently', async () => {
		serveProject('demoted', { grantedRole: 'editor', effectiveRole: 'editor' });
		post.mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, {
			error: 'You have view access to this project',
			reason: 'viewer',
		}));
		const { findByRole, findByTestId, queryByTestId } = renderPlanning(undefined, 'demoted');

		fireEvent.click(await findByRole('button', { name: /New/ }));
		await findByTestId('new-item-dialog');
		newItemDialog.props!.onCreate({ title: 'Roadmap' });

		const alert = await findByRole('alert');
		expect(alert.textContent).toContain('You have view access to this project');
		expect(queryByTestId('new-item-dialog')).toBeNull();
	});
});

describe('Planning assign to me (M)', () => {
	beforeEach(() => {
		getResponse.mockReset();
		succeedEmpty();
		window.history.replaceState({}, '', '/projects/acme/specboard/planning?view=board');
	});

	function card(assignee: { slug: string } | null): { key: string; assignee: { slug: string } | null; assign: ReturnType<typeof vi.fn> } {
		return { key: 'SPE-3', assignee, assign: vi.fn(async () => {}) };
	}

	it('assigns the card to the signed-in user by slug', async () => {
		get.mockImplementation(async (url: string) => (url === '/api/users/me' ? { slug: 'kev' } : {}));
		const { findByTestId } = renderPlanning();
		await findByTestId('board');
		const item = card(null);

		board.props!.onAssignToMe(item);

		await waitFor(() => expect(item.assign).toHaveBeenCalledWith('kev'));
	});

	it('sends nothing when the card is already theirs', async () => {
		get.mockImplementation(async (url: string) => (url === '/api/users/me' ? { slug: 'kev' } : {}));
		const { findByTestId } = renderPlanning();
		await findByTestId('board');
		const item = card({ slug: 'kev' });

		board.props!.onAssignToMe(item);

		await waitFor(() => expect(get).toHaveBeenCalledWith('/api/users/me'));
		expect(item.assign).not.toHaveBeenCalled();
	});

	it('shows the server\'s refusal above the board', async () => {
		get.mockImplementation(async (url: string) => (url === '/api/users/me' ? { slug: 'kev' } : {}));
		const { findByTestId, findByRole } = renderPlanning();
		await findByTestId('board');
		const item = card(null);
		item.assign.mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, { error: 'You have view access to this project' }));

		board.props!.onAssignToMe(item);

		expect((await findByRole('alert')).textContent).toContain('You have view access to this project');
	});
});
