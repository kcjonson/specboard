/**
 * The project settings page by role: the owner gets every section and manages members;
 * an editor or a viewer gets the member list read-only, with Leave project.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/preact';
import type { Member, PendingInvitation } from './settings-api';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const navigate = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: (...args: unknown[]) => put(...args),
		delete: (...args: unknown[]) => del(...args),
	},
}));

vi.mock('@specboard/router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/router')>()),
	navigate: (...args: unknown[]) => navigate(...args),
}));

import { ProjectSettings } from './ProjectSettings';
import { expiryText } from './settings-api';

const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;

afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

const OWNER: Member = {
	slug: 'dana', name: 'Dana Cho', email: 'dana@example.com', avatarUrl: null,
	role: 'owner', effectiveRole: 'owner', githubConnected: true, pushAccess: true,
};
const ALEX: Member = {
	slug: 'alex', name: 'Alex Rivera', email: 'alex@example.com', avatarUrl: null,
	role: 'editor', effectiveRole: 'editor', githubConnected: true, pushAccess: false,
};
const SAM: Member = {
	slug: 'sam', name: 'Sam Moss', email: 'sam@example.com', avatarUrl: null,
	role: 'editor', effectiveRole: 'viewer', githubConnected: false, pushAccess: null,
};
const PAT: PendingInvitation = {
	id: 'inv-1', email: 'pat@example.com', role: 'editor', invitedBy: 'Dana Cho',
	createdAt: '2026-10-01T00:00:00Z', expiresAt: new Date(Date.now() + 5 * 86_400_000 - 60_000).toISOString(), state: 'open',
};

let projectCount = 0;

const CLOUD_REPOSITORY = { type: 'cloud', remote: { provider: 'github', owner: 'acme', repo: 'roadmap', url: 'https://github.com/acme/roadmap' }, branch: 'main' };

/** Serve a fresh project (the page's model is cached per ref) as the given role. */
function serve(
	role: 'owner' | 'editor' | 'viewer',
	members: Member[] = [OWNER, ALEX, SAM],
	pending: PendingInvitation[] = [PAT],
	fields: Record<string, unknown> = {}
): string {
	const slug = `roadmap-${++projectCount}`;
	const ref = `dana/${slug}`;
	get.mockImplementation(async (url: string) => {
		if (url === `/api/projects/${ref}`) {
			return {
				id: `id-${slug}`, slug, ownerSlug: 'dana', ownerName: 'Dana Cho', key: 'RM', name: 'Roadmap',
				description: 'Plans', storageMode: 'cloud', syncStatus: 'completed', syncError: null,
				repository: CLOUD_REPOSITORY,
				grantedRole: role, effectiveRole: role, githubUsername: null, pushAccess: null,
				...fields,
			};
		}
		if (url === `/api/projects/${ref}/members`) return members;
		if (url === `/api/projects/${ref}/invitations`) return pending;
		if (url.startsWith('/api/github/')) return [];
		return {};
	});
	return slug;
}

function renderSettings(slug: string): ReturnType<typeof render> {
	return render(<ProjectSettings params={{ owner: 'dana', project: slug }} />);
}

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
	for (const fn of [get, post, put, del, navigate]) fn.mockReset();
	window.history.replaceState(null, '', '/');
});

describe('ProjectSettings for the owner', () => {
	it('offers every section and opens on General', async () => {
		const { findByRole, getByRole } = renderSettings(serve('owner'));

		const nav = await findByRole('navigation', { name: 'Settings sections' });
		expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['General', '#general'], ['AI', '#ai'], ['Repository', '#repository'], ['Members', '#members'], ['Danger zone', '#danger'],
		]);
		expect(within(nav).getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
		expect(getByRole('heading', { name: 'General' })).toBeTruthy();
		expect((getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Roadmap');
	});

	it('opens the section the URL hash names, and follows the hash as it changes', async () => {
		const slug = serve('owner');
		window.history.replaceState(null, '', `/projects/dana/${slug}/settings#members`);
		const { findByRole, getByRole } = renderSettings(slug);

		expect(await findByRole('heading', { name: 'Members' })).toBeTruthy();

		window.history.replaceState(null, '', '#ai');
		window.dispatchEvent(new Event('hashchange'));

		expect(await findByRole('heading', { name: 'AI' })).toBeTruthy();
		expect(getByRole('link', { name: 'AI' }).getAttribute('aria-current')).toBe('page');
	});

	it('shows a refused slug in place and stays put', async () => {
		const { FetchError } = await import('@specboard/fetch');
		const slug = serve('owner');
		put.mockRejectedValue(new FetchError('HTTP 409', 409, undefined, { error: 'That slug is already in use', code: 'IDENTIFIER_TAKEN', field: 'slug' }));
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.input(await findByRole('textbox', { name: /URL slug/ }), { target: { value: 'taken' } });
		fireEvent.click(getByRole('button', { name: 'Save' }));

		expect((await findByRole('alert')).textContent).toBe('That slug is already in use');
		expect(navigate).not.toHaveBeenCalled();
		expect((getByRole('textbox', { name: /URL slug/ }) as HTMLInputElement).value).toBe('taken');
	});

	it('saves the AI instructions', async () => {
		const slug = serve('owner', undefined, undefined, { systemPrompt: 'Be brief.' });
		put.mockResolvedValue({ slug, ownerSlug: 'dana', systemPrompt: 'Be very brief.' });
		window.history.replaceState(null, '', '#ai');
		const { findByRole, getByRole } = renderSettings(slug);

		const prompt = (await findByRole('textbox', { name: /AI instructions/ })) as HTMLTextAreaElement;
		expect(prompt.value).toBe('Be brief.');
		fireEvent.input(prompt, { target: { value: ' Be very brief. ' } });
		fireEvent.click(getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(put).toHaveBeenCalledWith(`/api/projects/dana/${slug}`, { system_prompt: 'Be very brief.' }));
		expect((await findByRole('status')).textContent).toBe('Saved.');
	});

	it('retries a failed sync', async () => {
		const slug = serve('owner', undefined, undefined, { syncStatus: 'failed', syncError: 'Clone failed' });
		post.mockResolvedValue({});
		window.history.replaceState(null, '', '#repository');
		const { findByRole, getByText } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Retry sync' }));

		expect(getByText('Clone failed')).toBeTruthy();
		await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/projects/dana/${slug}/sync/initial`));
	});

	it('attaches a repository to a project without one', async () => {
		const slug = serve('owner', undefined, undefined, { repository: {}, storageMode: 'none', syncStatus: null });
		const base = get.getMockImplementation()!;
		get.mockImplementation(async (url: string) => {
			if (url === '/api/github/connection') return { connected: true, username: 'dana', scopes: [], connectedAt: null };
			if (url === '/api/github/repos') return [{ id: 7, fullName: 'acme/site', name: 'site', owner: 'acme', private: false, defaultBranch: 'main', url: 'https://github.com/acme/site' }];
			if (url === '/api/github/repos/acme/site/branches') return [{ name: 'main' }, { name: 'dev' }];
			return base(url);
		});
		put.mockResolvedValue({ slug, ownerSlug: 'dana', repository: { type: 'cloud', remote: { provider: 'github', owner: 'acme', repo: 'site', url: 'https://github.com/acme/site' }, branch: 'main' } });
		window.history.replaceState(null, '', '#repository');
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.change(await findByRole('combobox', { name: 'Select GitHub repository' }), { target: { value: 'acme/site' } });
		await waitFor(() => expect((getByRole('combobox', { name: 'Select branch' }) as HTMLSelectElement).value).toBe('main'));
		const connect = getByRole('button', { name: 'Connect repository' });
		await waitFor(() => expect(connect.hasAttribute('disabled')).toBe(false));
		fireEvent.click(connect);

		await waitFor(() => expect(put).toHaveBeenCalledWith(`/api/projects/dana/${slug}`, {
			repository: { provider: 'github', owner: 'acme', repo: 'site', branch: 'main', url: 'https://github.com/acme/site' },
		}));
	});

	it('lists members with role selects, status chips and pending invitations', async () => {
		const slug = serve('owner');
		window.history.replaceState(null, '', '#members');
		const { findByRole, getByRole, getByText, queryByRole } = renderSettings(slug);

		const members = await findByRole('list', { name: 'Members' });
		const rows = within(members).getAllByRole('listitem');
		expect(rows).toHaveLength(3);
		expect(within(rows[0]!).getByText('Owner')).toBeTruthy();
		expect(queryByRole('combobox', { name: 'Role for Dana Cho' })).toBeNull();
		expect((getByRole('combobox', { name: 'Role for Alex Rivera' }) as HTMLSelectElement).value).toBe('editor');
		expect(within(rows[1]!).getByText('No push access to acme/roadmap')).toBeTruthy();
		expect(within(rows[2]!).getByText('Needs GitHub to edit')).toBeTruthy();

		const pending = getByRole('list', { name: 'Pending invitations' });
		expect(within(pending).getByText('pat@example.com')).toBeTruthy();
		expect(within(pending).getByText('expires in 5 days')).toBeTruthy();
		expect(getByText('Invite')).toBeTruthy();
	});

	it('changes a role with PUT and keeps the row', async () => {
		const slug = serve('owner');
		put.mockResolvedValue({ ...ALEX, role: 'viewer', effectiveRole: 'viewer' });
		window.history.replaceState(null, '', '#members');
		const { findByRole } = renderSettings(slug);

		const select = (await findByRole('combobox', { name: 'Role for Alex Rivera' })) as HTMLSelectElement;
		fireEvent.change(select, { target: { value: 'viewer' } });

		await waitFor(() => expect(put).toHaveBeenCalledWith(`/api/projects/dana/${slug}/members/alex`, { role: 'viewer' }));
		await waitFor(() => expect(select.value).toBe('viewer'));
	});

	it('removes a member only after confirming', async () => {
		const slug = serve('owner');
		del.mockResolvedValue({ success: true });
		window.history.replaceState(null, '', '#members');
		const { findByRole, getByRole, queryByText } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Remove Sam Moss' }));
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/projects/dana/${slug}/members/sam`));
		await waitFor(() => expect(queryByText('sam@example.com')).toBeNull());
	});

	it('resends and revokes pending invitations', async () => {
		const slug = serve('owner');
		post.mockResolvedValue({ ...PAT, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
		del.mockResolvedValue({ success: true });
		window.history.replaceState(null, '', '#members');
		const { findByRole, getByRole, findByText, queryByText } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Resend' }));
		await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/projects/dana/${slug}/invitations/inv-1/resend`));
		expect(await findByText('expires in 7 days')).toBeTruthy();

		fireEvent.click(getByRole('button', { name: 'Revoke' }));
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/projects/dana/${slug}/invitations/inv-1`));
		await waitFor(() => expect(queryByText('pat@example.com')).toBeNull());
	});

	it('re-reads the project when a role change is refused with a 403', async () => {
		const { FetchError } = await import('@specboard/fetch');
		const slug = serve('owner');
		put.mockRejectedValue(new FetchError('HTTP 403', 403, undefined, { error: 'Only the project owner can do that', reason: 'owner_only' }));
		window.history.replaceState(null, '', '#members');
		const { findByRole, findByText } = renderSettings(slug);
		const select = (await findByRole('combobox', { name: 'Role for Alex Rivera' })) as HTMLSelectElement;
		const reads = (): number => get.mock.calls.filter(([url]) => url === `/api/projects/dana/${slug}`).length;
		const before = reads();

		fireEvent.change(select, { target: { value: 'viewer' } });

		expect(await findByText('Only the project owner can do that')).toBeTruthy();
		await waitFor(() => expect(reads()).toBeGreaterThan(before));
		expect(select.value).toBe('editor');
	});

	it('shows a failed role change instead of dropping it', async () => {
		const { FetchError } = await import('@specboard/fetch');
		const slug = serve('owner');
		put.mockRejectedValue(new FetchError('HTTP 500', 500, undefined, { error: 'Database error' }));
		window.history.replaceState(null, '', '#members');
		const { findByRole, findByText } = renderSettings(slug);

		fireEvent.change(await findByRole('combobox', { name: 'Role for Alex Rivera' }), { target: { value: 'viewer' } });

		expect(await findByText('Database error')).toBeTruthy();
	});

	it('deletes the project after confirming, then goes to the list', async () => {
		const slug = serve('owner');
		del.mockResolvedValue({ success: true });
		window.history.replaceState(null, '', '#danger');
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Delete project' }));
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Delete project' }));

		await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/projects/dana/${slug}`));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects', { replace: true }));
	});

	it('moves to the new address when the slug changes', async () => {
		const slug = serve('owner');
		put.mockResolvedValue({ slug: 'plans', ownerSlug: 'dana', name: 'Roadmap', key: 'RM' });
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.input(await findByRole('textbox', { name: /URL slug/ }), { target: { value: 'plans' } });
		fireEvent.click(getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(put).toHaveBeenCalledWith(`/api/projects/dana/${slug}`, { name: 'Roadmap', description: 'Plans', slug: 'plans' }));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects/dana/plans/settings', { replace: true }));
	});
});

describe.each(['editor', 'viewer'] as const)('ProjectSettings for a %s', (role) => {
	it('shows only Members, read-only, with Leave project', async () => {
		const slug = serve(role, [{ ...OWNER, pushAccess: null }, { ...ALEX, pushAccess: null }, SAM]);
		window.history.replaceState(null, '', '#general');
		const { findByRole, getByRole, queryByRole, queryByText } = renderSettings(slug);

		const nav = await findByRole('navigation', { name: 'Settings sections' });
		expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Members']);
		expect(getByRole('heading', { name: 'Members' })).toBeTruthy();
		await findByRole('list', { name: 'Members' });

		expect(queryByRole('combobox')).toBeNull();
		expect(queryByRole('button', { name: /Remove/ })).toBeNull();
		expect(queryByRole('button', { name: 'Invite' })).toBeNull();
		expect(queryByText('Needs GitHub to edit')).toBeNull();
		expect(queryByRole('list', { name: 'Pending invitations' })).toBeNull();
		expect(get).not.toHaveBeenCalledWith(`/api/projects/dana/${slug}/invitations`);
		expect(getByRole('button', { name: 'Leave project' })).toBeTruthy();
	});

	it('leaves after confirming, then goes to the list', async () => {
		const slug = serve(role);
		del.mockResolvedValue({ success: true });
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Leave project' }));
		expect(del).not.toHaveBeenCalled();
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Leave project' }));

		await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/projects/dana/${slug}/membership`));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects'));
	});

	it('goes to the list when leaving finds the membership already gone', async () => {
		const { FetchError } = await import('@specboard/fetch');
		const slug = serve(role);
		del.mockRejectedValue(new FetchError('HTTP 404', 404, undefined, { error: 'Project not found' }));
		const { findByRole, getByRole } = renderSettings(slug);

		fireEvent.click(await findByRole('button', { name: 'Leave project' }));
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Leave project' }));

		await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects'));
	});
});

describe('ProjectSettings after a rename', () => {
	/** One project whose slug the tests move; the server answers at whichever slug it has now. */
	function serveMovable(): { current: () => string } {
		const id = `id-movable-${++projectCount}`;
		let slug = `alpha-${projectCount}`;
		const data = (): Record<string, unknown> => ({
			id, slug, ownerSlug: 'dana', ownerName: 'Dana Cho', key: 'RM', name: 'Roadmap', description: 'Plans',
			storageMode: 'none', repository: {}, syncStatus: null, syncError: null,
			grantedRole: 'owner', effectiveRole: 'owner', githubUsername: null, pushAccess: null,
		});
		get.mockImplementation(async (url: string) => (url === `/api/projects/dana/${slug}` ? data() : {}));
		put.mockImplementation(async (_url: string, body: { slug?: string }) => {
			if (body.slug) slug = body.slug;
			return data();
		});
		return { current: () => slug };
	}

	async function rename(from: string, to: string): Promise<void> {
		const view = renderSettings(from);
		fireEvent.input(await view.findByRole('textbox', { name: /URL slug/ }), { target: { value: to } });
		fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/projects/dana/${to}/settings`, { replace: true }));
		view.unmount();
		navigate.mockReset();
	}

	it('A to B and back to A leaves nothing stale under either address', async () => {
		const project = serveMovable();
		const a = project.current();
		const b = `beta-${projectCount}`;

		await rename(a, b);
		await rename(b, a);

		const { findByRole, getByRole } = renderSettings(a);
		const slugField = (await findByRole('textbox', { name: /URL slug/ })) as HTMLInputElement;
		expect(slugField.value).toBe(a);

		put.mockClear();
		fireEvent.input(getByRole('textbox', { name: 'Name' }), { target: { value: 'Roadmap 2' } });
		fireEvent.click(getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(put).toHaveBeenCalledWith(`/api/projects/dana/${a}`, { name: 'Roadmap 2', description: 'Plans' }));
		expect(navigate).not.toHaveBeenCalled();
	});

	it('waits for a fresh read before filling the form from a cached project', async () => {
		const project = serveMovable();
		const a = project.current();
		const first = renderSettings(a);
		await first.findByRole('textbox', { name: 'Name' });
		first.unmount();

		// Renamed somewhere else; this tab's cached model still says Roadmap.
		let land: (value: unknown) => void = () => {};
		get.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
		const second = renderSettings(a);

		expect(second.queryByRole('textbox', { name: 'Name' })).toBeNull();
		land({ slug: a, ownerSlug: 'dana', name: 'Renamed elsewhere', grantedRole: 'owner', effectiveRole: 'owner' });

		expect(((await second.findByRole('textbox', { name: 'Name' })) as HTMLInputElement).value).toBe('Renamed elsewhere');
	});
});

describe('expiryText', () => {
	const now = Date.parse('2026-10-07T12:00:00Z');

	it.each([
		['2026-10-12T11:00:00Z', 'open', 'expires in 5 days'],
		['2026-10-08T00:00:00Z', 'open', 'expires in 1 day'],
		['2026-10-07T11:00:00Z', 'open', 'expired'],
		['2026-10-12T11:00:00Z', 'expired', 'expired'],
	] as const)('%s (%s) reads %j', (expiresAt, state, expected) => {
		expect(expiryText({ expiresAt, state }, now)).toBe(expected);
	});
});
