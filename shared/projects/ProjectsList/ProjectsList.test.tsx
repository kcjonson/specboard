/**
 * The projects page's "View together" picker: entering and leaving it, cards acting as
 * checkboxes, the 2 to 10 limits, the same-prefix rule, the remembered selection, and
 * the address it opens.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/preact';
import type { Project } from '../ProjectCard/ProjectCard';
import { ProjectsList } from './ProjectsList';

const get = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: { get: (...args: unknown[]) => get(...args), getResponse: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
	};
});

// Where the remembered set is kept is the selection module's business (and its test's);
// here it's only what the picker reads and writes through it.
const remembered = vi.hoisted(() => ({ refs: [] as string[] }));
vi.mock('@shared/planning', async (importOriginal) => ({
	...(await importOriginal<typeof import('@shared/planning')>()),
	readRememberedSelection: (): string[] => [...remembered.refs],
	rememberSelection: (refs: readonly string[]): void => {
		remembered.refs = [...refs];
	},
}));

function project(slug: string, key: string, name: string, ownerSlug = 'acme'): Project {
	return {
		id: `id-${ownerSlug}-${slug}`,
		slug,
		ownerSlug,
		ownerName: ownerSlug === 'acme' ? 'Acme' : 'Bob',
		grantedRole: ownerSlug === 'acme' ? 'owner' : 'editor',
		effectiveRole: ownerSlug === 'acme' ? 'owner' : 'editor',
		key,
		name,
		itemCount: 0,
		createdAt: '2026-10-01T00:00:00Z',
		updatedAt: '2026-10-01T00:00:00Z',
	};
}

const ROADMAP = project('roadmap', 'RM', 'Roadmap');
const NOTES = project('notes', 'NOT', 'Notes');
const WEBSITE = project('website', 'WEB', 'Website');
/** Shared with this person by bob, and carrying the same prefix as acme/specboard. */
const BOBS_SPECBOARD = project('specboard', 'SPE', "Bob's Specboard", 'bob');
const SPECBOARD = project('specboard', 'SPE', 'Specboard');

let listed: Project[] = [];

beforeEach(() => {
	remembered.refs = [];
	document.cookie = 'lastProjectRef=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
	listed = [ROADMAP, NOTES, WEBSITE, SPECBOARD, BOBS_SPECBOARD];
	get.mockReset();
	// A signed-in user, so the header carries the account menu.
	get.mockImplementation(async (url: string) => {
		if (url === '/api/projects') return listed;
		if (url === '/api/users/me') return { id: 'u1', email: 'kevin@example.com', first_name: 'Kevin' };
		return {};
	});
	window.history.replaceState({}, '', '/projects');
});

afterEach(() => {
	cleanup();
});

async function renderList(): Promise<ReturnType<typeof render>> {
	const view = render(<ProjectsList params={{}} />);
	await view.findByText('Roadmap');
	return view;
}

function card(view: ReturnType<typeof render>, name: string): HTMLElement {
	return view.getByText(name, { selector: 'h3' }).closest('[role]') as HTMLElement;
}

async function startPicking(view: ReturnType<typeof render>): Promise<void> {
	fireEvent.click(view.getByRole('button', { name: 'View together' }));
	await view.findByRole('group', { name: 'Choose projects to view together' });
}

describe('ProjectsList picker', () => {
	it('offers View together beside New Project, once there are two projects to pick from', async () => {
		listed = [ROADMAP];
		const single = await renderList();
		expect(single.queryByRole('button', { name: 'View together' })).toBeNull();
		cleanup();

		listed = [ROADMAP, NOTES];
		const view = await renderList();
		expect(view.getByRole('button', { name: 'View together' })).toBeTruthy();
		expect(view.getByRole('button', { name: '+ New Project' })).toBeTruthy();
	});

	it('turns the cards into checkboxes, and the toolbar into the picker bar', async () => {
		const view = await renderList();
		expect(card(view, 'Roadmap').getAttribute('role')).toBe('button');

		await startPicking(view);

		const roadmap = card(view, 'Roadmap');
		expect(roadmap.getAttribute('role')).toBe('checkbox');
		expect(roadmap.getAttribute('aria-checked')).toBe('false');
		expect(roadmap.getAttribute('aria-label')).toBe('Roadmap (RM)');
		expect(view.queryByRole('button', { name: '+ New Project' })).toBeNull();
		expect(view.queryByRole('button', { name: 'Project settings' })).toBeNull();
		expect(view.getByText('0 selected')).toBeTruthy();
		expect(document.activeElement).toBe(view.getByRole('group', { name: 'Choose projects to view together' }));
	});

	it('toggles a card by click, Space, or Enter, opening nothing while it does', async () => {
		const view = await renderList();
		await startPicking(view);

		fireEvent.click(card(view, 'Roadmap'));
		expect(card(view, 'Roadmap').getAttribute('aria-checked')).toBe('true');
		expect(card(view, 'Roadmap').className).toContain('variant-selected');
		fireEvent.keyDown(card(view, 'Notes'), { key: ' ' });
		expect(card(view, 'Notes').getAttribute('aria-checked')).toBe('true');
		fireEvent.keyDown(card(view, 'Roadmap'), { key: 'Enter' });
		expect(card(view, 'Roadmap').getAttribute('aria-checked')).toBe('false');

		expect(view.getByText('1 selected')).toBeTruthy();
		expect(window.location.pathname).toBe('/projects');
		expect(document.cookie).not.toContain('lastProjectRef');
	});

	it('opens two to ten projects, and refuses an eleventh', async () => {
		listed = Array.from({ length: 11 }, (_, i) => project(`p${i + 1}`, `P${i + 1}`, `Project ${i + 1}`));
		const view = render(<ProjectsList params={{}} />);
		await view.findByText('Project 1');
		await startPicking(view);

		const open = (): HTMLButtonElement => view.getByRole('button', { name: /^View \d+ projects?$/ }) as HTMLButtonElement;
		expect(open().disabled).toBe(true);
		fireEvent.click(card(view, 'Project 1'));
		expect(open().textContent).toBe('View 1 project');
		expect(open().disabled).toBe(true);
		fireEvent.click(card(view, 'Project 2'));
		expect(open().disabled).toBe(false);

		for (let n = 3; n <= 10; n++) fireEvent.click(card(view, `Project ${n}`));
		expect(open().textContent).toBe('View 10 projects');
		expect(open().disabled).toBe(false);

		fireEvent.click(card(view, 'Project 11'));
		expect(card(view, 'Project 11').getAttribute('aria-checked')).toBe('false');
		expect(view.getByText('You can view up to 10 projects together.')).toBeTruthy();
		expect(open().textContent).toBe('View 10 projects');
	});

	it('refuses a second project with the same key prefix, and says which project has it', async () => {
		const view = await renderList();
		await startPicking(view);

		fireEvent.click(card(view, 'Specboard'));
		fireEvent.click(card(view, "Bob's Specboard"));

		expect(card(view, "Bob's Specboard").getAttribute('aria-checked')).toBe('false');
		expect(view.getByText('SPE is already used by Specboard; pick one of them.')).toBeTruthy();

		// Any change that goes through clears it, and the count is back in its place.
		fireEvent.click(card(view, 'Specboard'));
		expect(view.queryByText('SPE is already used by Specboard; pick one of them.')).toBeNull();
		expect(view.getByText('0 selected')).toBeTruthy();
		fireEvent.click(card(view, "Bob's Specboard"));
		expect(card(view, "Bob's Specboard").getAttribute('aria-checked')).toBe('true');
	});

	it('leaves by Cancel or Escape, handing focus back to View together', async () => {
		const view = await renderList();
		await startPicking(view);
		fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
		expect(view.queryByRole('group', { name: 'Choose projects to view together' })).toBeNull();
		expect(card(view, 'Roadmap').getAttribute('role')).toBe('button');
		expect(document.activeElement).toBe(view.getByRole('button', { name: 'View together' }));

		await startPicking(view);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(view.queryByRole('group', { name: 'Choose projects to view together' })).toBeNull();
		expect(document.activeElement).toBe(view.getByRole('button', { name: 'View together' }));
	});

	it('keeps picking when an Escape closes the account menu instead', async () => {
		const view = await renderList();
		await startPicking(view);
		fireEvent.click(card(view, 'Roadmap'));

		fireEvent.click(await view.findByRole('button', { name: 'User menu for Kevin' }));
		expect(view.getByRole('menu')).toBeTruthy();
		fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });

		expect(view.queryByRole('menu')).toBeNull();
		expect(view.getByRole('group', { name: 'Choose projects to view together' })).toBeTruthy();
		expect(card(view, 'Roadmap').getAttribute('aria-checked')).toBe('true');

		// With the menu shut, the next Escape is the picker's.
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(view.queryByRole('group', { name: 'Choose projects to view together' })).toBeNull();
	});

	it('opens the chosen projects together in the order chosen, and remembers them', async () => {
		const view = await renderList();
		await startPicking(view);

		fireEvent.click(card(view, 'Website'));
		fireEvent.click(card(view, 'Roadmap'));
		fireEvent.click(within(view.getByRole('group', { name: 'Choose projects to view together' })).getByRole('button', { name: 'View 2 projects' }));

		expect(window.location.pathname + window.location.search).toBe('/planning?projects=acme/website,acme/roadmap');
		expect(remembered.refs).toEqual(['acme/website', 'acme/roadmap']);
		expect(document.cookie).not.toContain('lastProjectRef');
	});

	it('starts from the projects last opened together, skipping any no longer listed', async () => {
		remembered.refs = ['acme/notes', 'carol/gone', 'acme/roadmap'];
		const view = await renderList();
		await startPicking(view);

		expect(card(view, 'Notes').getAttribute('aria-checked')).toBe('true');
		expect(card(view, 'Roadmap').getAttribute('aria-checked')).toBe('true');
		expect(card(view, 'Website').getAttribute('aria-checked')).toBe('false');
		expect(view.getByText('2 selected')).toBeTruthy();

		fireEvent.click(view.getByRole('button', { name: 'View 2 projects' }));
		expect(window.location.search).toBe('?projects=acme/notes,acme/roadmap');
	});

	it('starts from the first of two remembered projects that have come to share a prefix', async () => {
		remembered.refs = ['bob/specboard', 'acme/roadmap', 'acme/specboard'];
		const view = await renderList();
		await startPicking(view);

		expect(card(view, "Bob's Specboard").getAttribute('aria-checked')).toBe('true');
		expect(card(view, 'Roadmap').getAttribute('aria-checked')).toBe('true');
		expect(card(view, 'Specboard').getAttribute('aria-checked')).toBe('false');
	});
});
