/**
 * The multi-project view: what it makes of its address, what it says about projects it
 * leaves out, its views over the mixed projects (a read-only Board, the Table with each
 * row's project, the Map over all of them), the read-only drawer each view opens in
 * place, the filters it keeps in its address, and how often it polls.
 *
 * The view is mounted through the router, as the app mounts it, so the navigations that
 * open and close the drawer re-render it the way they do in the app.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor, within } from '@testing-library/preact';
import { render as renderInto } from 'preact';
import type { JSX } from 'preact';
import { startRouter, type RouteProps } from '@specboard/router';
import { FetchError } from '@specboard/fetch';
import type { MapViewProps } from '../Map/MapView';
import type { MapProjectFailure } from '../Map/map-data-model';
import { COMBINED_POLL_INTERVAL, usePolling } from '../hooks/usePolling';
import { memoryStorage } from '../test-support/memory-storage';
import { MultiProjectPlanning } from './MultiProjectPlanning';

const get = vi.fn();
const getResponse = vi.fn();
const post = vi.fn();
const put = vi.fn();
const remove = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: {
			get: (...args: unknown[]) => get(...args),
			getResponse: (...args: unknown[]) => getResponse(...args),
			post: (...args: unknown[]) => post(...args),
			put: (...args: unknown[]) => put(...args),
			delete: (...args: unknown[]) => remove(...args),
		},
	};
});

// The poll's own rules are usePolling's test; here it's only what this view asks of it.
vi.mock('../hooks/usePolling', async (importOriginal) => ({
	...(await importOriginal<typeof import('../hooks/usePolling')>()),
	usePolling: vi.fn(),
}));

/** What the view handed the Map the last time it drew it. */
let mapProps: MapViewProps | null = null;
vi.mock('../Map/MapView', () => ({
	MapView: (props: MapViewProps) => {
		mapProps = props;
		const projects = 'projects' in props.scope ? props.scope.projects.map((project) => project.ref).join(',') : '';
		return (
			<div data-testid="map" data-projects={projects} data-open={props.openItemKey ?? ''} data-search={props.search} data-type={props.type ?? ''}>
				<button type="button" onClick={() => props.onOpenItem('TWO-1', 'acme/two')}>TWO-1 on the Map</button>
				<button type="button" onClick={props.onClear}>Clear the Map</button>
			</div>
		);
	},
}));

// The drawer's sections each read their own sub-resource; here they only say whose
// project they would read, and whether they offer changes.
vi.mock('../ChildrenSection/ChildrenSection', () => ({
	ChildrenSection: ({ item, canEdit }: { item: { projectRef: string }; canEdit: boolean }) => (
		<div data-testid="section" data-project={item.projectRef} data-can-edit={String(canEdit)} />
	),
}));
vi.mock('../ChecklistSection/ChecklistSection', () => ({
	ChecklistSection: ({ projectRef, canEdit }: { projectRef: string; canEdit: boolean }) => (
		<div data-testid="section" data-project={projectRef} data-can-edit={String(canEdit)} />
	),
}));
vi.mock('../BlockersSection/BlockersSection', () => ({
	BlockersSection: ({ projectRef, canEdit }: { projectRef: string; canEdit: boolean }) => (
		<div data-testid="section" data-project={projectRef} data-can-edit={String(canEdit)} />
	),
}));
vi.mock('../SpecsSection/SpecsSection', () => ({
	SpecsSection: ({ projectRef, canEdit }: { projectRef: string; canEdit: boolean }) => (
		<div data-testid="section" data-project={projectRef} data-can-edit={String(canEdit)} />
	),
}));
vi.mock('../NotesSection/NotesSection', () => ({
	NotesSection: ({ projectRef, canEdit }: { projectRef: string; canEdit: boolean }) => (
		<div data-testid="section" data-project={projectRef} data-can-edit={String(canEdit)} />
	),
}));
// The parent picker and the description editor bring in Slate, which none of this needs.
vi.mock('@specboard/pages', () => ({ ItemPicker: () => null }));
vi.mock('../RichTextEditor', () => ({
	RichTextEditor: () => <div data-testid="description" />,
	serializeToText: () => '',
	deserializeFromText: () => [],
}));

/** What GET /api/projects lists: bob/one is shared with this person and has acme/one's prefix. */
const READABLE = [
	{ ownerSlug: 'acme', slug: 'one', key: 'ONE', name: 'One' },
	{ ownerSlug: 'acme', slug: 'two', key: 'TWO', name: 'Two' },
	{ ownerSlug: 'bob', slug: 'one', key: 'ONE', name: "Bob's One" },
];

type Row = Record<string, unknown>;

function item(key: string, n: number, fields: Row = {}): Row {
	return { id: `id-${key}-${n}`, key: `${key}-${n}`, number: n, status: 'ready', type: 'task', rank: n, title: `${key} item ${n}`, updatedAt: 't1', ...fields };
}

/** Each project's Ready rows, or the status its every window request fails with. */
let served: Record<string, Row[] | number> = {};

/** The item pages the router shows when the view sends someone to an item in its own project. */
function ItemPage({ params }: RouteProps): JSX.Element {
	return <p>Item page for {params.itemKey} in {params.owner}/{params.project}</p>;
}

let stopRouter: (() => void) | null = null;
let root: HTMLElement | null = null;

/**
 * Mounts the app's routes at an address. Arriving is a push, which also drops any entries
 * an earlier test left ahead of this one, so history lengths compare within the test.
 */
function renderAt(address: string): ReturnType<typeof within> & { container: HTMLElement } {
	window.history.pushState({}, '', address);
	const container = document.body.appendChild(document.createElement('div'));
	root = container;
	act(() => {
		stopRouter = startRouter([
			{ route: '/planning', entry: MultiProjectPlanning },
			{ route: '/projects/:owner/:project/items/:itemKey', entry: ItemPage },
		], container);
	});
	return { container, ...within(container) };
}

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
	get.mockReset();
	getResponse.mockReset();
	post.mockReset();
	put.mockReset();
	remove.mockReset();
	vi.mocked(usePolling).mockClear();
	vi.stubGlobal('localStorage', memoryStorage());
	mapProps = null;
	setWidth(false);
	served = {
		'acme/one': [item('ONE', 1), item('ONE', 2)],
		'acme/two': [item('TWO', 1, { type: 'epic', childStats: { total: 1, done: 0, blocked: 0 } })],
	};
	get.mockImplementation(async (url: string) => {
		if (url === '/api/projects') return READABLE;
		// The child's prefix isn't TWO: the project's key was renamed since the list was read.
		if (url === '/api/projects/acme/two/items/TWO-1') {
			return {
				...item('TWO', 1, { type: 'epic' }),
				children: [{ id: 'id-TW2-7', key: 'TW2-7', number: 7, type: 'task', title: 'Child seven', status: 'ready' }],
			};
		}
		if (url === '/api/projects/acme/two/items/TW2-7') return item('TW2', 7, { title: 'Child seven', parentKey: 'TWO-1' });
		if (url === '/api/projects/acme/two/items/TWO-8') return item('TWO', 8, { title: 'Child eight', parentKey: 'TWO-1' });
		if (url === '/api/projects/acme/one/items/ONE-2') return item('ONE', 2);
		return {};
	});
	getResponse.mockImplementation(async (url: string) => {
		const parsed = new URL(url, 'http://x');
		const ref = parsed.pathname.replace(/^\/api\/projects\//, '').replace(/\/items$/, '');
		const answer = served[ref];
		if (answer === undefined) throw new Error(`Unexpected request ${url}`);
		if (typeof answer === 'number') throw new FetchError(`HTTP ${answer}`, answer);
		const rows = parsed.searchParams.get('status') === 'ready' ? answer : [];
		return { data: rows, headers: new Headers({ 'X-Total-Count': String(rows.length) }) };
	});
});

afterEach(() => {
	stopRouter?.();
	stopRouter = null;
	if (root) {
		const container = root;
		act(() => renderInto(null, container));
		container.remove();
		root = null;
	}
	delete (window as { matchMedia?: unknown }).matchMedia;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** The table's item rows (focusable, unlike its header and section rows), top to bottom. */
function itemRows(container: Element): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>('[role="row"][tabindex="0"]'));
}

function requested(ref: string): string[] {
	return getResponse.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(`/api/projects/${ref}/items?`));
}

/** The Board card showing an item's title (the drawer may show the same title). */
function card(view: { container: HTMLElement }, title: string): HTMLElement {
	const cards = Array.from(view.container.querySelectorAll<HTMLElement>('[data-item-card]'));
	return cards.find((element) => within(element).queryByRole('heading', { name: title }) !== null)!;
}

/**
 * Preact runs a render's effects a frame after it, and the Board's keys are a document
 * listener one of them adds; nothing paints in a test, so this waits out the fallback.
 */
async function afterEffects(): Promise<void> {
	await act(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
}

/** The open drawer, found by its heading (`TWO-1 · Epic`). */
async function findDrawer(view: ReturnType<typeof within>, heading: string): Promise<HTMLElement> {
	const title = await view.findByRole('heading', { name: heading });
	return title.parentElement!.parentElement!;
}

describe('MultiProjectPlanning address', () => {
	it('says what is wrong with an address it cannot use, and links back to the projects', async () => {
		const { findByRole, getByText, getByRole } = renderAt('/planning?projects=acme/one');

		expect(await findByRole('heading', { name: "These projects can't be viewed together" })).toBeTruthy();
		expect(getByText('This link names one project, and viewing together takes at least 2.')).toBeTruthy();
		expect(getByRole('link', { name: 'Choose projects' }).getAttribute('href')).toBe('/projects');
		expect(get).not.toHaveBeenCalledWith('/api/projects');
	});

	it('refuses an entry that is not a project address', async () => {
		const { findByText } = renderAt('/planning?projects=acme/one,two');
		expect(await findByText(`"two" isn't a project address. Addresses look like owner/project.`)).toBeTruthy();
	});

	it('is not a project page: a plain title, no Planning or Pages tabs, no last-project cookie', async () => {
		document.cookie = 'lastProjectRef=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
		const { findByText, getByText, queryByRole } = renderAt('/planning?projects=acme/one,acme/two');
		await findByText('ONE item 1');

		expect(getByText('Multi-project view')).toBeTruthy();
		expect(queryByRole('link', { name: 'Planning' })).toBeNull();
		expect(queryByRole('link', { name: 'Pages' })).toBeNull();
		expect(document.cookie).not.toContain('lastProjectRef');
	});
});

describe('MultiProjectPlanning projects', () => {
	it('lists the chosen projects in the order chosen, each linking to its own planning view', async () => {
		const { findByRole } = renderAt('/planning?projects=acme/two,acme/one');

		const list = await findByRole('list', { name: 'Projects in this view' });
		const links = within(list).getAllByRole('link');
		expect(links.map((link) => link.textContent)).toEqual(['TwoTWO', 'OneONE']);
		expect(links.map((link) => link.getAttribute('href'))).toEqual(['/projects/acme/two/planning', '/projects/acme/one/planning']);
		expect(links.map((link) => link.getAttribute('title'))).toEqual(['acme/two', 'acme/one']);
	});

	it('leaves out a project the person cannot read, names it, and offers a way back to choose', async () => {
		const { findByText, getByRole, queryByRole } = renderAt('/planning?projects=acme/one,carol/secret,acme/two');

		expect(await findByText("carol/secret isn't shown: it doesn't exist, or you can't read it.")).toBeTruthy();
		expect(within(getByRole('list', { name: 'Projects in this view' })).getAllByRole('link')).toHaveLength(2);
		expect(await findByText('TWO item 1')).toBeTruthy();
		expect(getByRole('link', { name: 'Choose projects' }).getAttribute('href')).toBe('/projects');
		expect(queryByRole('link', { name: /on its own/ })).toBeNull();
	});

	it('still shows the one readable project left, and offers its own board too', async () => {
		const { findByText, getByRole } = renderAt('/planning?projects=acme/one,carol/missing');

		expect(await findByText("carol/missing isn't shown: it doesn't exist, or you can't read it.")).toBeTruthy();
		expect(await findByText('ONE item 1')).toBeTruthy();
		expect(getByRole('link', { name: 'Choose projects' }).getAttribute('href')).toBe('/projects');
		expect(getByRole('link', { name: 'Open One on its own' }).getAttribute('href')).toBe('/projects/acme/one/planning');
	});

	it('drops the later of two projects with the same key prefix, without asking for its items', async () => {
		const { findByText } = renderAt('/planning?projects=acme/one,bob/one,acme/two');

		expect(await findByText("Bob's One (bob/one) isn't shown: its key ONE is already used by One.")).toBeTruthy();
		await findByText('TWO item 1');
		expect(requested('bob/one')).toEqual([]);
	});

	it('drops a project whose items it can no longer read, and shows the rest', async () => {
		served['acme/two'] = 403;
		const { findByText, getByRole } = renderAt('/planning?projects=acme/one,acme/two');

		expect(await findByText("Two isn't shown: it doesn't exist, or you can't read it.")).toBeTruthy();
		expect(await findByText('ONE item 1')).toBeTruthy();
		const links = within(getByRole('list', { name: 'Projects in this view' })).getAllByRole('link');
		expect(links.map((link) => link.getAttribute('href'))).toEqual(['/projects/acme/one/planning']);
		expect(getByRole('link', { name: 'Open One on its own' }).getAttribute('href')).toBe('/projects/acme/one/planning');
	});

	it('says so when none of the projects can be shown', async () => {
		const { findByRole, getByText } = renderAt('/planning?projects=carol/a,carol/b');

		expect(await findByRole('heading', { name: 'None of these projects can be shown' })).toBeTruthy();
		expect(getByText("carol/a and carol/b aren't shown: they don't exist, or you can't read them.")).toBeTruthy();
	});

	it('shows any other failure where the view goes, and Retry brings it back', async () => {
		served['acme/two'] = 500;
		const { findByRole, findByText, queryByRole } = renderAt('/planning?projects=acme/one,acme/two');

		const alert = await findByRole('alert');
		expect(alert.textContent).toContain('HTTP 500');
		expect(queryByRole('list', { name: 'Projects in this view' })).not.toBeNull();

		served['acme/two'] = [item('TWO', 1)];
		fireEvent.click(await findByRole('button', { name: 'Retry' }));
		expect(await findByText('TWO item 1')).toBeTruthy();
		await waitFor(() => expect(queryByRole('alert')).toBeNull());
	});
});

describe('MultiProjectPlanning views', () => {
	it('opens on the Board, and offers Board, Table, and Map', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		await view.findByText('TWO item 1');

		expect(view.getByRole('listbox', { name: 'Ready column' })).toBeTruthy();
		const toggle = view.getByRole('group', { name: 'View' });
		expect(within(toggle).getAllByRole('button').map((button) => button.textContent)).toEqual(['Board', 'Table', 'Map']);
	});

	it('mixes the projects on the Board, every card carrying its project\'s chip', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		await view.findByText('TWO item 1');

		const ready: HTMLElement = view.getByRole('listbox', { name: 'Ready column' });
		const cards = Array.from(ready.querySelectorAll<HTMLElement>('[data-item-card]'));
		expect(cards.map((element) => within(element).getByRole('heading').textContent)).toEqual(['ONE item 1', 'TWO item 1', 'ONE item 2']);
		expect(within(cards[1]!).getByText('Two').getAttribute('title')).toBe('acme/two');
		expect(within(cards[0]!).getByText('One').getAttribute('title')).toBe('acme/one');
	});

	it('keeps the Board read-only: nothing to create, drag, or move, while the arrow keys still select', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		await view.findByText('TWO item 1');

		expect(view.queryByRole('button', { name: /New/ })).toBeNull();
		for (const element of view.container.querySelectorAll('[data-item-card]')) {
			expect(element.getAttribute('draggable')).toBe('false');
		}
		const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
		view.getByRole('listbox', { name: 'In Progress column' }).dispatchEvent(dragOver);
		expect(dragOver.defaultPrevented).toBe(false);

		await afterEffects();
		fireEvent.keyDown(document, { key: 'ArrowDown' });
		await waitFor(() => expect(card(view, 'ONE item 1').getAttribute('aria-selected')).toBe('true'));
		fireEvent.keyDown(document, { key: 'ArrowDown' });
		await waitFor(() => expect(card(view, 'TWO item 1').getAttribute('aria-selected')).toBe('true'));

		fireEvent.keyDown(document, { key: 'n' });
		fireEvent.keyDown(document, { key: '2' });
		expect(put).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
		expect(view.queryByRole('dialog')).toBeNull();
		expect(view.getByRole('listbox', { name: 'Ready column' }).textContent).toContain('TWO item 1');
	});

	it('opens a card\'s new window in the card\'s own project', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const view = renderAt('/planning?projects=acme/one,acme/two');
		await view.findByText('TWO item 1');

		fireEvent.click(within(card(view, 'TWO item 1')).getByRole('button', { name: 'Open in new window' }));
		expect(open).toHaveBeenCalledWith('/projects/acme/two/items/TWO-1', '_blank', 'noopener,noreferrer');
	});

	it('mixes the projects in the Table round-robin, every row carrying its project\'s chip', async () => {
		const { container, findByText, getByRole } = renderAt('/planning?projects=acme/one,acme/two&view=table');
		await findByText('TWO item 1');

		expect(getByRole('columnheader', { name: 'Project' })).toBeTruthy();
		const rows = itemRows(container);
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining('ONE-1'),
			expect.stringContaining('TWO-1'),
			expect.stringContaining('ONE-2'),
		]);
		expect(within(rows[1]!).getByText('Two').getAttribute('title')).toBe('acme/two');
		expect(within(rows[0]!).getByText('One').getAttribute('title')).toBe('acme/one');
	});

	it('opens on the view picked last when the address names none', async () => {
		globalThis.localStorage.setItem('specboard.planning.view', 'table');
		const { findByRole } = renderAt('/planning?projects=acme/one,acme/two');
		expect(await findByRole('columnheader', { name: 'Project' })).toBeTruthy();
	});

	it('makes a new view a history entry, keeping the rest of the address as written, and remembers it', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&search=auth');
		await view.findByText('ONE item 1');
		const before = window.history.length;

		fireEvent.click(view.getByRole('button', { name: 'Table' }));
		expect(await view.findByRole('columnheader', { name: 'Project' })).toBeTruthy();
		expect(window.location.search).toBe('?projects=acme/one,acme/two&search=auth&view=table');
		expect(window.history.length).toBe(before + 1);
		expect(globalThis.localStorage.getItem('specboard.planning.view')).toBe('table');

		fireEvent.click(view.getByRole('button', { name: 'Board' }));
		expect(await view.findByRole('listbox', { name: 'Ready column' })).toBeTruthy();
		window.history.back();
		expect(await view.findByRole('columnheader', { name: 'Project' })).toBeTruthy();
	});

	it('lands on the Board below 768 px, with no Map on offer, and keeps asking for the Map', async () => {
		setWidth(true);
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map');

		expect(await view.findByRole('listbox', { name: 'Ready column' })).toBeTruthy();
		expect(view.queryByTestId('map')).toBeNull();
		expect(view.queryByRole('button', { name: 'Map' })).toBeNull();
		expect(view.getByRole('button', { name: 'Table' })).toBeTruthy();
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=map');
	});

	it('drops a Map anchor when leaving the Map', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map&focus=ONE-1');
		await view.findByTestId('map');

		fireEvent.click(view.getByRole('button', { name: 'Board' }));
		expect(await view.findByRole('listbox', { name: 'Ready column' })).toBeTruthy();
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=board');
	});
});

describe('MultiProjectPlanning Map', () => {
	it('draws every chosen project, dimming by the settled search and type without narrowing the lists', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map');
		const map = await view.findByTestId('map');
		expect(map.getAttribute('data-projects')).toBe('acme/one,acme/two');
		getResponse.mockClear();

		fireEvent.input(view.container.querySelector('input[type="search"]')!, { target: { value: 'auth' } });
		await waitFor(() => expect(map.getAttribute('data-search')).toBe('auth'));
		fireEvent.change(view.container.querySelector('select')!, { target: { value: 'bug' } });
		await waitFor(() => expect(map.getAttribute('data-type')).toBe('bug'));
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=map&search=auth&type=bug');
		expect(getResponse).not.toHaveBeenCalled();

		fireEvent.click(view.getByRole('button', { name: 'Clear the Map' }));
		await waitFor(() => expect(map.getAttribute('data-search')).toBe(''));
		expect(map.getAttribute('data-type')).toBe('');
		expect((view.container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
	});

	it('names a project that can\'t be read once, in the notice for everything left out, whatever the Map says of it', async () => {
		served['acme/two'] = 403;
		const view = renderAt('/planning?projects=acme/one,carol/secret,acme/two&view=map');
		await view.findByTestId('map');
		const leftOut = "carol/secret and Two aren't shown: they don't exist, or you can't read them.";
		await view.findByText(leftOut);

		const naming = (): HTMLElement[] => view.getAllByText(/Two/).filter((element: HTMLElement) => element.closest('[role="status"]'));

		const held: MapProjectFailure = { error: new FetchError('HTTP 500', 500), unreadable: false, held: true };
		act(() => mapProps!.onFailures!(new Map([['acme/two', held]])));
		expect(naming()).toHaveLength(1);
		expect(view.getByText(leftOut)).toBeTruthy();

		const unreadable: MapProjectFailure = { error: new FetchError('HTTP 403', 403), unreadable: true, held: false };
		act(() => mapProps!.onFailures!(new Map([['acme/two', unreadable]])));
		expect(naming()).toHaveLength(1);
		expect(view.getByText(leftOut)).toBeTruthy();
	});

	it('leaves out a project only the Map has found it cannot read', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map');
		await view.findByTestId('map');

		act(() => mapProps!.onFailures!(new Map([['acme/two', { error: new FetchError('HTTP 404', 404), unreadable: true, held: false }]])));

		expect(await view.findByText("Two isn't shown: it doesn't exist, or you can't read it.")).toBeTruthy();
		const links = within(view.getByRole('list', { name: 'Projects in this view' })).getAllByRole('link');
		expect(links.map((link) => link.getAttribute('href'))).toEqual(['/projects/acme/one/planning']);
	});

	it('says which projects the Map is still trying to read, drawn as last loaded or not at all, while it shows', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map');
		await view.findByTestId('map');

		act(() => mapProps!.onFailures!(new Map([
			['acme/one', { error: new FetchError('HTTP 500', 500), unreadable: false, held: true }],
			['acme/two', { error: new FetchError('HTTP 502', 502), unreadable: false, held: false }],
		])));
		expect(await view.findByText("One couldn't be refreshed, so the Map shows it as last loaded. The Map keeps trying.")).toBeTruthy();
		expect(view.getByText("Two couldn't be loaded on the Map, so it isn't drawn. The Map keeps trying.")).toBeTruthy();
		const links = within(view.getByRole('list', { name: 'Projects in this view' })).getAllByRole('link');
		expect(links).toHaveLength(2);
		// Nothing is left out, so there's nothing to choose again.
		expect(view.queryByRole('link', { name: 'Choose projects' })).toBeNull();

		fireEvent.click(view.getByRole('button', { name: 'Board' }));
		await view.findByRole('listbox', { name: 'Ready column' });
		expect(view.queryByText(/The Map keeps trying/)).toBeNull();
	});
});

describe('MultiProjectPlanning drawer', () => {
	it('opens a card in place, read-only, as a new history entry, reading from the item\'s own project', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		const title = await view.findByText('TWO item 1');
		const before = window.history.length;
		fireEvent.click(title);

		const drawer = await findDrawer(view, 'TWO-1 · Epic');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&item=TWO-1');
		expect(window.history.length).toBe(before + 1);
		expect(within(drawer).queryByLabelText('Status')).toBeNull();
		expect(within(drawer).queryByRole('button', { name: /^Delete/ })).toBeNull();
		await waitFor(() => expect(get).toHaveBeenCalledWith('/api/projects/acme/two/items/TWO-1'));
		const sections = within(drawer).getAllByTestId('section');
		expect(sections.map((section) => section.getAttribute('data-project'))).toEqual(Array(5).fill('acme/two'));
		expect(sections.every((section) => section.getAttribute('data-can-edit') === 'false')).toBe(true);
		expect(put).not.toHaveBeenCalled();
	});

	it('links to the item in its own project, where the person\'s role decides what they can change', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const view = renderAt('/planning?projects=acme/one,acme/two');
		fireEvent.click(await view.findByText('TWO item 1'));
		const drawer = await findDrawer(view, 'TWO-1 · Epic');

		expect(within(drawer).getByText('Read-only in this view.')).toBeTruthy();
		const link = within(drawer).getByRole('link', { name: 'Open in Two' });
		expect(link.getAttribute('href')).toBe('/projects/acme/two/items/TWO-1');
		fireEvent.click(within(drawer).getByRole('button', { name: 'Open in new window' }));
		expect(open).toHaveBeenCalledWith('/projects/acme/two/items/TWO-1', '_blank', 'noopener,noreferrer');

		fireEvent.click(link);
		expect(await view.findByText('Item page for TWO-1 in acme/two')).toBeTruthy();
		window.history.back();
		expect(await findDrawer(view, 'TWO-1 · Epic')).toBeTruthy();
	});

	it('moves to another item in place, and closes back to where it was opened', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		fireEvent.click(await view.findByText('TWO item 1'));
		await findDrawer(view, 'TWO-1 · Epic');
		const length = window.history.length;

		fireEvent.click(card(view, 'ONE item 2'));
		const drawer = await findDrawer(view, 'ONE-2 · Task');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&item=ONE-2');
		expect(window.history.length).toBe(length);
		expect(card(view, 'ONE item 2').getAttribute('aria-selected')).toBe('true');

		fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two'));
		expect(view.queryByRole('heading', { name: 'ONE-2 · Task' })).toBeNull();
	});

	it('closes in place after another view is picked, staying on that view', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		fireEvent.click(await view.findByText('TWO item 1'));
		await findDrawer(view, 'TWO-1 · Epic');

		fireEvent.click(view.getByRole('button', { name: 'Table' }));
		expect(await view.findByRole('columnheader', { name: 'Project' })).toBeTruthy();
		expect(window.location.search).toBe('?projects=acme/one,acme/two&item=TWO-1&view=table');

		const drawer = await findDrawer(view, 'TWO-1 · Epic');
		fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table'));
		expect(view.queryByRole('heading', { name: 'TWO-1 · Epic' })).toBeNull();
		expect(view.getByRole('columnheader', { name: 'Project' })).toBeTruthy();
	});

	it('closes on Escape from inside the drawer, the way its close button does', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two');
		fireEvent.click(await view.findByText('TWO item 1'));
		const drawer = await findDrawer(view, 'TWO-1 · Epic');

		fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Close' }), { key: 'Escape' });
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two'));
		expect(view.queryByRole('heading', { name: 'TWO-1 · Epic' })).toBeNull();
	});

	it('reopens from &item= on a reload, a child past the lists too, and closes without leaving the page', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&item=two-8');
		const drawer = await findDrawer(view, 'TWO-8 · Task');
		expect(get).toHaveBeenCalledWith('/api/projects/acme/two/items/TWO-8');
		expect(within(drawer).getByRole('link', { name: 'Open in Two' }).getAttribute('href')).toBe('/projects/acme/two/items/TWO-8');
		const length = window.history.length;

		fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two'));
		expect(window.history.length).toBe(length);
		expect(view.getByRole('listbox', { name: 'Ready column' })).toBeTruthy();
	});

	it('opens nothing for an item none of these projects has', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&item=XYZ-1');
		await view.findByText('TWO item 1');
		expect(view.queryByRole('button', { name: 'Close' })).toBeNull();
		expect(get).not.toHaveBeenCalledWith(expect.stringContaining('XYZ-1'));
	});

	it('opens Table rows, and a child row in its parent\'s project whatever its key says, and closes on Escape there', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=table');
		fireEvent.click(await view.findByText('TWO item 1'));
		await findDrawer(view, 'TWO-1 · Epic');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table&item=TWO-1');

		fireEvent.click(view.getByRole('button', { name: 'Expand' }));
		const childTitle: HTMLElement = await view.findByText('Child seven');
		const child = childTitle.closest<HTMLElement>('[role="row"]')!;
		expect(within(child).getByText('Two').getAttribute('title')).toBe('acme/two');
		fireEvent.click(child);
		const drawer = await findDrawer(view, 'TW2-7 · Task');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table&item=TW2-7');
		expect(get).toHaveBeenCalledWith('/api/projects/acme/two/items/TW2-7');
		expect(within(drawer).getByRole('link', { name: 'Open in Two' }).getAttribute('href')).toBe('/projects/acme/two/items/TW2-7');

		fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table'));
		expect(view.queryByRole('heading', { name: 'TW2-7 · Task' })).toBeNull();
	});

	it('opens a dot from the Map over the Map, which keeps the open item selected', async () => {
		const view = renderAt('/planning?projects=acme/one,acme/two&view=map');
		const map = await view.findByTestId('map');
		await waitFor(() => expect(getResponse).toHaveBeenCalled());

		fireEvent.click(view.getByRole('button', { name: 'TWO-1 on the Map' }));
		const drawer = await findDrawer(view, 'TWO-1 · Epic');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=map&item=TWO-1');
		expect(map.getAttribute('data-open')).toBe('TWO-1');
		expect(drawer.closest('[class*="drawerOverlay"]')).not.toBeNull();

		act(() => mapProps!.onCloseItem());
		await waitFor(() => expect(map.getAttribute('data-open')).toBe(''));
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=map');
	});
});

describe('MultiProjectPlanning filters', () => {
	it('applies the search and type to every project, and keeps them in the address', async () => {
		const { container, findByText } = renderAt('/planning?projects=acme/one,acme/two');
		await findByText('ONE item 1');

		fireEvent.input(container.querySelector('input[type="search"]')!, { target: { value: 'auth' } });
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two&search=auth'));
		await waitFor(() => {
			expect(requested('acme/one').some((url) => url.includes('search=auth'))).toBe(true);
			expect(requested('acme/two').some((url) => url.includes('search=auth'))).toBe(true);
		});

		fireEvent.change(container.querySelector('select')!, { target: { value: 'bug' } });
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two&search=auth&type=bug'));
		await waitFor(() => expect(requested('acme/two').at(-1)).toContain('search=auth&type=bug'));
	});

	it('keeps the rest of the address, the hash too, when it rewrites the filters', async () => {
		const { container, findByText } = renderAt('/planning?projects=acme/one,acme/two&view=table&item=ONE-1#top');
		await findByText('TWO item 1');

		fireEvent.input(container.querySelector('input[type="search"]')!, { target: { value: 'auth' } });
		await waitFor(() => expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table&item=ONE-1&search=auth'));
		expect(window.location.hash).toBe('#top');
	});

	it('normalizes the address in place, without rebuilding the projects it already has', async () => {
		const { findByText } = renderAt('/planning?projects=Acme/One,%20acme/two&view=table');
		await findByText('TWO item 1');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&view=table');

		// The router renders the page again for the normalized address, which parses to new arrays.
		getResponse.mockClear();
		act(() => {
			window.dispatchEvent(new Event('popstate'));
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getResponse).not.toHaveBeenCalled();
		expect(await findByText('TWO item 1')).toBeTruthy();
	});

	it('follows Back and Forward to the filters the address carries', async () => {
		const { container, findByText } = renderAt('/planning?projects=acme/one,acme/two');
		await findByText('ONE item 1');

		window.history.pushState({}, '', '/planning?projects=acme/one,acme/two&search=auth&type=bug');
		fireEvent(window, new Event('popstate'));

		await waitFor(() => expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('auth'));
		expect((container.querySelector('select') as HTMLSelectElement).value).toBe('bug');
		await waitFor(() => expect(requested('acme/two').at(-1)).toContain('search=auth&type=bug'));
		// Settled as it arrived: no detour through the type alone, in the requests or the address.
		expect(requested('acme/two').filter((url) => url.includes('type=bug') && !url.includes('search=auth'))).toEqual([]);
		expect(window.location.search).toBe('?projects=acme/one,acme/two&search=auth&type=bug');
	});

	it('opens on the filters its address carries, asking for nothing unfiltered', async () => {
		const { container, findByText } = renderAt('/planning?projects=acme/one,acme/two&search=auth&type=bug');
		await findByText('ONE item 1');

		const urls = getResponse.mock.calls.map(([url]) => String(url));
		expect(urls).toHaveLength(10);
		expect(urls.every((url) => url.includes('&search=auth&type=bug'))).toBe(true);
		expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('auth');
		expect((container.querySelector('select') as HTMLSelectElement).value).toBe('bug');
		expect(window.location.search).toBe('?projects=acme/one,acme/two&search=auth&type=bug');
	});
});

describe('MultiProjectPlanning polling', () => {
	it('polls every 30 seconds, and a poll asks every project', async () => {
		const { findByText } = renderAt('/planning?projects=acme/one,acme/two');
		await findByText('TWO item 1');

		expect(COMBINED_POLL_INTERVAL).toBe(30_000);
		const [poll, skip, interval] = vi.mocked(usePolling).mock.calls.at(-1)!;
		expect(interval).toBe(COMBINED_POLL_INTERVAL);
		expect(skip!()).toBe(false);

		getResponse.mockClear();
		void poll();
		await waitFor(() => {
			expect(requested('acme/one')).toHaveLength(5);
			expect(requested('acme/two')).toHaveLength(5);
		});
	});

	it('holds its polls while the view is in error', async () => {
		served['acme/two'] = 500;
		const { findByRole } = renderAt('/planning?projects=acme/one,acme/two');
		await findByRole('alert');

		const [, skip] = vi.mocked(usePolling).mock.calls.at(-1)!;
		expect(skip!()).toBe(true);
	});
});
