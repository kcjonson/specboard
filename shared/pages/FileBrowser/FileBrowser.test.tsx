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

	it('points the owner at project settings instead of offering a local folder', async () => {
		const { findByText, queryByText, getByRole } = render(<FileBrowser projectRef="acme/specboard" canOpenSettings />);

		await findByText('No repository connected');
		expect(queryByText('+ Add Folder')).toBeNull();
		expect(getByRole('link', { name: 'Open project settings' }).getAttribute('href')).toBe(
			'/projects?edit=acme/specboard'
		);
	});

	it('leaves the settings link off for anyone but the owner', async () => {
		const { findByText, queryByRole } = render(<FileBrowser projectRef="acme/specboard" />);

		await findByText('No repository connected');
		expect(queryByRole('link', { name: 'Open project settings' })).toBeNull();
	});

	it('still points at settings when the shell exposes no folder picker', async () => {
		window.platform = { openExternal: async () => {} };
		const { findByText, queryByText } = render(<FileBrowser projectRef="acme/specboard" />);

		await findByText('No repository connected');
		expect(queryByText('+ Add Folder')).toBeNull();
	});

	it('offers Add Folder when the shell has a folder picker, and adds what it picks', async () => {
		const showOpenDialog = vi.fn(async () => '/repo/docs');
		window.platform = { showOpenDialog };
		const { findByText, queryByText } = render(<FileBrowser projectRef="acme/specboard" />);

		const button = await findByText('+ Add Folder');
		expect(queryByText('No repository connected')).toBeNull();

		fireEvent.click(button);
		await waitFor(() =>
			expect(post).toHaveBeenCalledWith('/api/projects/acme/specboard/folders', { path: '/repo/docs' })
		);
		expect(showOpenDialog).toHaveBeenCalledWith({ directory: true });
	});

	it('shows a rejected picker as an error instead of throwing', async () => {
		window.platform = { showOpenDialog: vi.fn(async () => { throw new Error('No handler registered'); }) };
		const { findByText } = render(<FileBrowser projectRef="acme/specboard" />);

		fireEvent.click(await findByText('+ Add Folder'));
		await findByText('No handler registered');
	});
});

describe('FileBrowser read-only', () => {
	const TREE = {
		files: [
			{ name: 'docs', path: '/docs', type: 'directory' },
			{ name: 'spec.md', path: '/docs/spec.md', type: 'file' },
		],
		expanded: {},
		rootPaths: ['/docs'],
		syncStatus: 'completed',
		syncError: null,
	};

	beforeEach(() => {
		post.mockReset();
		post.mockResolvedValue(TREE);
	});

	it('browses with no create, delete or remove controls', async () => {
		const { findByText, queryByRole } = render(<FileBrowser projectRef="acme/specboard" readOnly />);

		await findByText('spec.md');
		expect(queryByRole('button', { name: 'New file in folder' })).toBeNull();
		expect(queryByRole('button', { name: 'Remove folder from project' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete file' })).toBeNull();
	});

	it('doesn\'t start a rename on double-click', async () => {
		const { findByText, queryByRole } = render(<FileBrowser projectRef="acme/specboard" readOnly />);

		fireEvent.dblClick(await findByText('spec.md'));

		expect(queryByRole('textbox', { name: 'Rename file' })).toBeNull();
	});

	it('offers all of them to an editor (the control for the tests above)', async () => {
		const { findByText, getByRole } = render(<FileBrowser projectRef="acme/specboard" />);

		await findByText('spec.md');
		expect(getByRole('button', { name: 'New file in folder' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete file' })).toBeTruthy();
	});

	it('hides the sync retry, which only an editor can run', async () => {
		post.mockResolvedValue({ ...EMPTY_TREE, syncStatus: 'failed', syncError: 'Clone failed' });
		const { findByText, queryByText } = render(<FileBrowser projectRef="acme/specboard" readOnly />);

		await findByText('Sync failed');
		expect(queryByText('Retry Sync')).toBeNull();
	});
});
