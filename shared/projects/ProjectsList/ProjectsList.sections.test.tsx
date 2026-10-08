/**
 * The projects list: owned and shared projects apart, owner-only actions on owned cards
 * only, and the signed-in user's open invitations on top with Accept and Decline.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import type { Project } from '../ProjectCard/ProjectCard';
import type { Invitation } from '../InvitationCard/InvitationCard';

const get = vi.fn();
const post = vi.fn();
const navigate = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock('@specboard/router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/router')>()),
	navigate: (...args: unknown[]) => navigate(...args),
}));

import { ProjectsList } from './ProjectsList';

function project(fields: Partial<Project> & Pick<Project, 'slug' | 'name' | 'ownerSlug' | 'grantedRole'>): Project {
	return {
		id: `id-${fields.ownerSlug}-${fields.slug}`,
		key: 'RM',
		ownerName: 'Dana Cho',
		effectiveRole: fields.grantedRole,
		itemCount: 0,
		createdAt: '2026-10-01T00:00:00Z',
		updatedAt: '2026-10-01T00:00:00Z',
		...fields,
	};
}

const MINE = project({ slug: 'roadmap', name: 'Roadmap', ownerSlug: 'dana', grantedRole: 'owner', syncStatus: 'failed', syncError: 'Clone failed' });
const ATLAS = project({
	slug: 'atlas', name: 'Atlas', ownerSlug: 'alex', ownerName: 'Alex Rivera', grantedRole: 'editor',
	effectiveRole: 'viewer', syncStatus: 'failed', syncError: 'Clone failed',
});
const NOTES = project({ slug: 'notes', name: 'Notes', ownerSlug: 'jo', ownerName: 'Jo Lee', grantedRole: 'viewer' });

const INVITE: Invitation = {
	id: 'inv-1', role: 'editor', project: { ref: 'pat/website', name: 'Website' }, ownerName: 'Pat Kim',
	inviterName: 'Pat Kim', createdAt: '2026-10-05T00:00:00Z', expiresAt: '2026-10-12T00:00:00Z',
};

function serve(projects: Project[], invitations: Invitation[] | Error = []): void {
	get.mockImplementation(async (url: string) => {
		if (url === '/api/projects') return projects;
		if (url === '/api/invitations') {
			if (invitations instanceof Error) throw invitations;
			return invitations;
		}
		return {};
	});
}

function cardFor(container: HTMLElement, name: string): HTMLElement {
	return within(container).getByRole('heading', { name, level: 3 }).closest('[role="button"]') as HTMLElement;
}

beforeEach(() => {
	get.mockReset();
	post.mockReset();
	navigate.mockReset();
});

describe('ProjectsList grouping', () => {
	it('puts owned projects under Your projects and the rest under Shared with you', async () => {
		serve([MINE, ATLAS, NOTES]);
		const { findByRole, getByRole } = render(<ProjectsList params={{}} />);

		const yours = await findByRole('region', { name: 'Your projects' });
		const shared = getByRole('region', { name: 'Shared with you' });
		expect(within(yours).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Roadmap']);
		expect(within(shared).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Atlas', 'Notes']);

		const atlas = cardFor(shared, 'Atlas');
		expect(within(atlas).getByText('Alex Rivera')).toBeTruthy();
		expect(within(atlas).getByText('Editor')).toBeTruthy();
		expect(within(cardFor(shared, 'Notes')).getByText('Viewer')).toBeTruthy();
	});

	it('offers settings and retry sync on owned cards only', async () => {
		serve([MINE, ATLAS]);
		const { findByRole, getByRole } = render(<ProjectsList params={{}} />);

		const mine = cardFor(await findByRole('region', { name: 'Your projects' }), 'Roadmap');
		const atlas = cardFor(getByRole('region', { name: 'Shared with you' }), 'Atlas');

		expect(within(mine).getByRole('button', { name: 'Project settings' })).toBeTruthy();
		expect(within(mine).getByRole('button', { name: 'Retry' })).toBeTruthy();
		expect(within(atlas).queryByRole('button', { name: 'Project settings' })).toBeNull();
		expect(within(atlas).queryByRole('button', { name: 'Retry' })).toBeNull();
		// The raw error is about the owner's repository; a member gets only that it failed.
		expect(within(mine).getByText('Clone failed')).toBeTruthy();
		expect(within(atlas).getByText('Sync failed')).toBeTruthy();
		expect(within(atlas).queryByText('Clone failed')).toBeNull();

		fireEvent.click(within(mine).getByRole('button', { name: 'Project settings' }));
		expect(navigate).toHaveBeenCalledWith('/projects/dana/roadmap/settings');
	});

	it('leaves out Shared with you when nothing is shared', async () => {
		serve([MINE]);
		const { findByRole, queryByRole } = render(<ProjectsList params={{}} />);

		await findByRole('region', { name: 'Your projects' });
		expect(queryByRole('region', { name: 'Shared with you' })).toBeNull();
	});

	it('shows the empty state with no projects and no invitations', async () => {
		serve([]);
		const { findByText, queryByRole } = render(<ProjectsList params={{}} />);

		expect(await findByText('No projects yet')).toBeTruthy();
		expect(queryByRole('region', { name: 'Your projects' })).toBeNull();
	});
});

describe('ProjectsList invitations', () => {
	it('shows open invitations above the projects', async () => {
		serve([ATLAS], [INVITE]);
		const { findByRole } = render(<ProjectsList params={{}} />);

		const invitations = await findByRole('region', { name: 'Invitations' });
		expect(invitations.textContent).toContain('Pat Kim invited you to Website as Editor');
		expect(invitations.compareDocumentPosition(await findByRole('region', { name: 'Shared with you' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('accepts and opens the project', async () => {
		serve([], [INVITE]);
		post.mockResolvedValue({ project: { ref: 'pat/website', name: 'Website' }, role: 'editor', alreadyMember: false });
		const { findByRole } = render(<ProjectsList params={{}} />);

		fireEvent.click(await findByRole('button', { name: 'Accept the invitation to Website' }));

		await waitFor(() => expect(post).toHaveBeenCalledWith('/api/invitations/inv-1/accept'));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects/pat/website/planning'));
	});

	it('declines and drops the card', async () => {
		serve([MINE], [INVITE]);
		post.mockResolvedValue({ success: true });
		const { findByRole, queryByRole } = render(<ProjectsList params={{}} />);

		fireEvent.click(await findByRole('button', { name: 'Decline the invitation to Website' }));

		await waitFor(() => expect(post).toHaveBeenCalledWith('/api/invitations/inv-1/decline'));
		await waitFor(() => expect(queryByRole('region', { name: 'Invitations' })).toBeNull());
		expect(navigate).not.toHaveBeenCalled();
	});

	it('shows a failed accept on the card', async () => {
		serve([], [INVITE]);
		post.mockRejectedValue(new FetchError('HTTP 500', 500, undefined, { error: 'Database error' }));
		const { findByRole, getByRole } = render(<ProjectsList params={{}} />);

		fireEvent.click(await findByRole('button', { name: 'Accept the invitation to Website' }));

		expect((await findByRole('alert')).textContent).toBe('Database error');
		expect(getByRole('button', { name: 'Accept the invitation to Website' }).hasAttribute('disabled')).toBe(false);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('reloads the invitations when one closed under the card', async () => {
		serve([MINE], [INVITE]);
		post.mockRejectedValue(new FetchError('HTTP 410', 410, undefined, { error: 'This invitation was revoked', code: 'INVITATION_CLOSED', state: 'revoked' }));
		const { findByRole, findByText } = render(<ProjectsList params={{}} />);

		fireEvent.click(await findByRole('button', { name: 'Accept the invitation to Website' }));

		expect(await findByText('The invitation to Website was revoked.')).toBeTruthy();
		await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/api/invitations')).toHaveLength(2));
	});

	it('treats an invitation whose project is gone like a closed one', async () => {
		serve([MINE], [INVITE]);
		post.mockRejectedValue(new FetchError('HTTP 404', 404, undefined, { error: 'Invitation not found' }));
		const { findByRole, findByText } = render(<ProjectsList params={{}} />);

		fireEvent.click(await findByRole('button', { name: 'Decline the invitation to Website' }));

		expect(await findByText('The invitation to Website is no longer open.')).toBeTruthy();
		await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/api/invitations')).toHaveLength(2));
	});

	it('says why a shared editor project is view only, without a hover', async () => {
		serve([ATLAS]);
		const { findByRole } = render(<ProjectsList params={{}} />);

		const atlas = cardFor(await findByRole('region', { name: 'Shared with you' }), 'Atlas');
		expect(within(atlas).getByText('View only until you connect GitHub')).toBeTruthy();
	});

	it('keeps the projects when the invitations fail to load', async () => {
		serve([MINE], new Error('offline'));
		const { findByRole, findByText } = render(<ProjectsList params={{}} />);

		expect(await findByRole('region', { name: 'Your projects' })).toBeTruthy();
		expect(await findByText("Couldn't load your invitations.")).toBeTruthy();
	});
});
