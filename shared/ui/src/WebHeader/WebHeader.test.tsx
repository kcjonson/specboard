/**
 * The header on a project page: the project's name, never its owner, and the settings
 * gear beside the tabs.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';

const get = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
	},
}));

import { WebHeader } from './WebHeader';

beforeEach(() => {
	get.mockReset();
	get.mockImplementation(async (url: string) => {
		if (url.startsWith('/api/projects/acme/')) {
			return { id: url, name: 'Roadmap', ownerName: 'Alice Ames', grantedRole: 'editor', effectiveRole: 'editor', pushAccess: null };
		}
		return {};
	});
});

describe('WebHeader on a project page', () => {
	it('shows the project name without its owner', async () => {
		const { findAllByText, container } = render(<WebHeader projectRef="acme/roadmap" activeTab="Planning" />);

		await findAllByText('Roadmap');
		expect(container.textContent).not.toContain('acme');
	});

	it('has a settings gear after the tabs, current on the settings page', async () => {
		const planning = render(<WebHeader projectRef="acme/gear" activeTab="Planning" />);
		const gear = planning.getAllByRole('link', { name: 'Project settings' })[0]!;
		expect(gear.getAttribute('href')).toBe('/projects/acme/gear/settings');
		expect(gear.getAttribute('aria-current')).toBeNull();
		planning.unmount();

		const settings = render(<WebHeader projectRef="acme/gear" activeTab="Settings" />);
		expect(settings.getAllByRole('link', { name: 'Project settings' })[0]!.getAttribute('aria-current')).toBe('page');
	});

	it('shows no owner or gear off a project', () => {
		const { queryByRole } = render(<WebHeader title="Projects" />);

		expect(queryByRole('link', { name: 'Project settings' })).toBeNull();
		expect(queryByRole('link', { name: 'acme' })).toBeNull();
	});
});
