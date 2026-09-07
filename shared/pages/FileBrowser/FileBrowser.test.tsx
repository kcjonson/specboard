/**
 * FileBrowser empty state
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
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

	it('still points at settings when the shell exposes no folder picker', async () => {
		window.platform = { openExternal: async () => {} };
		const { findByText, queryByText } = render(<FileBrowser projectSlug="specboard" />);

		await findByText('No repository connected');
		expect(queryByText('+ Add Folder')).toBeNull();
	});

	it('offers Add Folder when the shell has a folder picker, and adds what it picks', async () => {
		const showOpenDialog = vi.fn(async () => '/repo/docs');
		window.platform = { showOpenDialog };
		const { findByText, queryByText } = render(<FileBrowser projectSlug="specboard" />);

		const button = await findByText('+ Add Folder');
		expect(queryByText('No repository connected')).toBeNull();

		fireEvent.click(button);
		await waitFor(() =>
			expect(post).toHaveBeenCalledWith('/api/projects/specboard/folders', { path: '/repo/docs' })
		);
		expect(showOpenDialog).toHaveBeenCalledWith({ directory: true });
	});

	it('shows a rejected picker as an error instead of throwing', async () => {
		window.platform = { showOpenDialog: vi.fn(async () => { throw new Error('No handler registered'); }) };
		const { findByText } = render(<FileBrowser projectSlug="specboard" />);

		fireEvent.click(await findByText('+ Add Folder'));
		await findByText('No handler registered');
	});
});
