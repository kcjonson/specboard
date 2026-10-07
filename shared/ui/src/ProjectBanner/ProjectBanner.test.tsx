/**
 * The read-only banner and the header badge, as a member sees them on a project page.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

const get = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
	},
}));

const connectGitHub = vi.fn();

vi.mock('@specboard/models', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/models')>()),
	connectGitHub: (...args: unknown[]) => connectGitHub(...args),
}));

import { Page } from '../Page/Page';

const REPOSITORY = {
	type: 'cloud',
	remote: { provider: 'github', owner: 'acme-corp', repo: 'roadmap', url: 'https://github.com/acme-corp/roadmap' },
	branch: 'main',
};

/** Serve the project with these fields; the user and GitHub connection reads alongside it. */
function serve(projectRef: string, fields: Record<string, unknown>): void {
	get.mockImplementation(async (url: string) => {
		if (url === `/api/projects/${projectRef}`) {
			return { id: 'p1', name: 'Roadmap', ownerName: 'Alice Ames', repository: REPOSITORY, pushAccess: null, ...fields };
		}
		if (url === '/api/github/connection') return { connected: true, username: 'vera' };
		return {};
	});
}

function renderPage(projectRef: string): ReturnType<typeof render> {
	return render(<Page projectRef={projectRef} activeTab="Planning"><div /></Page>);
}

beforeEach(() => {
	get.mockReset();
	connectGitHub.mockReset();
});

describe('project banner', () => {
	it('tells a granted viewer whom to ask, and badges the header', async () => {
		serve('acme/viewer', { grantedRole: 'viewer', effectiveRole: 'viewer' });
		const { findByRole, getByText } = renderPage('acme/viewer');

		expect((await findByRole('status')).textContent).toBe('You have view access. Ask Alice Ames for edit access.');
		expect(getByText('View only')).toBeTruthy();
	});

	it('sends an editor without GitHub through OAuth and back to this page', async () => {
		serve('acme/no-github', { grantedRole: 'editor', effectiveRole: 'viewer' });
		window.history.replaceState({}, '', '/projects/acme/no-github/planning?view=table');

		const { findByRole, getByText } = renderPage('acme/no-github');
		expect((await findByRole('status')).textContent).toContain('Connect GitHub to start editing.');
		expect(getByText('View only')).toBeTruthy();

		fireEvent.click(await findByRole('button', { name: 'Connect GitHub' }));
		expect(connectGitHub).toHaveBeenCalledWith('/projects/acme/no-github/planning?view=table');
	});

	it('warns an editor whose GitHub account can\'t push, without making the page read-only', async () => {
		serve('acme/no-push', { grantedRole: 'editor', effectiveRole: 'editor', pushAccess: false });
		const { findByText, queryByText } = renderPage('acme/no-push');

		expect(await findByText("Your GitHub account @vera can't push to acme-corp/roadmap. Ask the repo owner to add you.")).toBeTruthy();
		expect(queryByText('View only')).toBeNull();
	});

	it('shows nothing to an editor who can push', async () => {
		serve('acme/editor', { grantedRole: 'editor', effectiveRole: 'editor', pushAccess: true });
		const { findAllByText, queryByRole, queryByText } = renderPage('acme/editor');

		// The header (and its small-screen menu) only names the project once it has loaded.
		await findAllByText('Roadmap');
		expect(queryByRole('status')).toBeNull();
		expect(queryByText('View only')).toBeNull();
	});
});
