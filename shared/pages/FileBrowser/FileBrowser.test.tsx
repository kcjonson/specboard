/**
 * FileBrowser empty state
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/preact';
import { FileBrowser } from './FileBrowser';

const post = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: vi.fn(),
		post: (...args: unknown[]) => post(...args),
		put: vi.fn(),
		delete: vi.fn(),
	},
	FetchError: class extends Error {},
}));

/** What the API returns for a project that has no repository yet. */
const EMPTY_TREE = { files: [], expanded: {}, rootPaths: [], syncStatus: null, syncError: null };

describe('FileBrowser with no repository', () => {
	beforeEach(() => {
		post.mockReset();
		post.mockResolvedValue(EMPTY_TREE);
	});

	afterEach(() => {
		delete window.platform;
	});

	it('points a web user at project settings instead of offering a local folder', async () => {
		const { findByText, queryByText, getByRole } = render(<FileBrowser projectSlug="specboard" />);

		await findByText('No repository connected');
		expect(queryByText('+ Add Folder')).toBeNull();
		expect(getByRole('link', { name: 'Open project settings' }).getAttribute('href')).toBe(
			'/projects?edit=specboard'
		);
	});

	it('offers Add Folder inside the desktop shell', async () => {
		window.platform = {
			openExternal: async () => {},
			showOpenDialog: async () => null,
		};
		const { findByText, queryByText } = render(<FileBrowser projectSlug="specboard" />);

		await findByText('+ Add Folder');
		expect(queryByText('No repository connected')).toBeNull();
	});
});
