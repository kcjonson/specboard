/**
 * The multi-project view: what it makes of its address, what it says about projects it
 * leaves out, the mixed Table with each row's project, opening items in their own
 * projects, the filters it keeps in its address, and how often it polls.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { COMBINED_POLL_INTERVAL, usePolling } from '../hooks/usePolling';
import { memoryStorage } from '../test-support/memory-storage';
import { MultiProjectPlanning } from './MultiProjectPlanning';

const get = vi.fn();
const getResponse = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: {
			get: (...args: unknown[]) => get(...args),
			getResponse: (...args: unknown[]) => getResponse(...args),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		},
	};
});

// The poll's own rules are usePolling's test; here it's only what this view asks of it.
vi.mock('../hooks/usePolling', async (importOriginal) => ({
	...(await importOriginal<typeof import('../hooks/usePolling')>()),
	usePolling: vi.fn(),
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

beforeEach(() => {
	get.mockReset();
	getResponse.mockReset();
	vi.mocked(usePolling).mockClear();
	vi.stubGlobal('localStorage', memoryStorage());
	served = {
		'acme/one': [item('ONE', 1), item('ONE', 2)],
		'acme/two': [item('TWO', 1, { type: 'epic', childStats: { total: 1, done: 0, blocked: 0 } })],
	};
	get.mockImplementation(async (url: string) => {
		if (url === '/api/projects') return READABLE;
		if (url === '/api/projects/acme/two/items/TWO-1') {
			return {
				...item('TWO', 1, { type: 'epic' }),
				children: [{ id: 'id-TWO-7', key: 'TWO-7', number: 7, type: 'task', title: 'Child seven', status: 'ready' }],
			};
		}
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
	cleanup();
	vi.unstubAllGlobals();
});

function renderAt(address: string): ReturnType<typeof render> {
	window.history.replaceState({}, '', address);
	return render(<MultiProjectPlanning />);
}

/** The table's item rows (focusable, unlike its header and section rows), top to bottom. */
function itemRows(container: Element): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>('[role="row"][tabindex="0"]'));
}

function requested(ref: string): string[] {
	return getResponse.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(`/api/projects/${ref}/items?`));
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

	it('leaves out a project the person cannot read, and names it', async () => {
		const { findByText, getByRole } = renderAt('/planning?projects=acme/one,carol/secret,acme/two');

		expect(await findByText("carol/secret isn't shown: it doesn't exist, or you can't read it.")).toBeTruthy();
		expect(within(getByRole('list', { name: 'Projects in this view' })).getAllByRole('link')).toHaveLength(2);
		expect(await findByText('TWO item 1')).toBeTruthy();
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
	});

	it('says so when none of the projects can be shown', async () => {
		const { findByRole, getByText } = renderAt('/planning?projects=carol/a,carol/b');

		expect(await findByRole('heading', { name: 'None of these projects can be shown' })).toBeTruthy();
		expect(getByText("carol/a and carol/b aren't shown: they don't exist, or you can't read them.")).toBeTruthy();
	});

	it('shows any other failure where the table goes, and Retry brings it back', async () => {
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

describe('MultiProjectPlanning table', () => {
	it('mixes the projects round-robin, every row carrying its project\'s chip', async () => {
		const { container, findByText, getByRole } = renderAt('/planning?projects=acme/one,acme/two');
		await findByText('TWO item 1');

		expect(getByRole('columnheader', { name: 'Project' })).toBeTruthy();
		const rows = itemRows(container);
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining('ONE-1'),
			expect.stringContaining('TWO-1'),
			expect.stringContaining('ONE-2'),
		]);
		const chip = within(rows[1]!).getByText('Two');
		expect(chip.getAttribute('title')).toBe('acme/two');
		expect(within(rows[0]!).getByText('One').getAttribute('title')).toBe('acme/one');
	});

	it('opens an item on its own page in its own project, as a new history entry', async () => {
		const { findByText } = renderAt('/planning?projects=acme/one,acme/two');
		const before = window.history.length;

		fireEvent.click(await findByText('TWO item 1'));

		expect(window.location.pathname).toBe('/projects/acme/two/items/TWO-1');
		expect(window.history.length).toBe(before + 1);
	});

	it('opens a child in its parent\'s project, and shows the parent\'s chip on it', async () => {
		const { findByRole, findByText } = renderAt('/planning?projects=acme/one,acme/two');

		fireEvent.click(await findByRole('button', { name: 'Expand' }));
		const child = (await findByText('Child seven')).closest('[role="row"]') as HTMLElement;
		expect(within(child).getByText('Two').getAttribute('title')).toBe('acme/two');

		fireEvent.click(child);
		expect(window.location.pathname).toBe('/projects/acme/two/items/TWO-7');
	});
});

describe('MultiProjectPlanning filters', () => {
	it('applies the search and type to every project, and keeps them in the address for Back', async () => {
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
