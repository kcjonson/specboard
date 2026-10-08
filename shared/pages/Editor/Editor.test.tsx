/**
 * The editor for someone who can't edit the project: it mounts read-only, offers no
 * comments, renames, epic links, commits or AI edits, and doesn't resurrect a local
 * draft it couldn't save. A local project's members get a note instead of the tree.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { saveToLocalStorage, type DocumentModel } from '@specboard/models';
import { memoryStorage } from '../../planning/test-support/memory-storage';

const get = vi.fn();
const put = vi.fn();

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: vi.fn(),
		put: (...args: unknown[]) => put(...args),
		delete: vi.fn(),
	},
}));

// Each child is stubbed to the props the editor hands it, which is what decides
// whether a viewer is offered a write.
const seen = vi.hoisted(() => ({
	editor: null as Record<string, unknown> | null,
	header: null as Record<string, unknown> | null,
	files: null as Record<string, unknown> | null,
	chat: null as Record<string, unknown> | null,
}));

vi.mock('../MarkdownEditor', async (importOriginal) => ({
	...(await importOriginal<typeof import('../MarkdownEditor')>()),
	MarkdownEditor: (props: Record<string, unknown>) => {
		seen.editor = props;
		return <div data-testid="markdown-editor" />;
	},
}));
vi.mock('./EditorHeader', () => ({
	EditorHeader: (props: Record<string, unknown>) => {
		seen.header = props;
		return null;
	},
}));
vi.mock('../FileBrowser/FileBrowser', () => ({
	FileBrowser: (props: Record<string, unknown>) => {
		seen.files = props;
		return <div data-testid="file-browser" />;
	},
}));
vi.mock('../ChatSidebar', () => ({
	ChatSidebar: (props: Record<string, unknown>) => {
		seen.chat = props;
		return null;
	},
}));
vi.mock('./RecoveryDialog', () => ({
	RecoveryDialog: () => <div data-testid="recovery-dialog" />,
}));

import { Editor } from './Editor';

const FILE = '/docs/spec.md';

/** Serve a project (with the caller's roles) that last had FILE open, and the file itself. */
function serve(project: string, fields: Record<string, unknown>): void {
	get.mockImplementation(async (url: string) => {
		if (url === `/api/projects/acme/${project}`) {
			return { id: `id-${project}`, name: 'Docs', ownerName: 'Alice Ames', storageMode: 'cloud', pushAccess: null, ...fields };
		}
		if (url.startsWith(`/api/projects/acme/${project}/files`)) return { content: '# Spec\n\nBody' };
		if (url.startsWith(`/api/projects/acme/${project}/items`)) return [];
		if (url.endsWith('/git/status')) return { branch: 'main', changedFiles: [] };
		return {};
	});
	globalThis.localStorage.setItem('editor.selectedFile', JSON.stringify({ [`id-${project}`]: FILE }));
}

function renderEditor(project: string): ReturnType<typeof render> {
	return render(<Editor params={{ owner: 'acme', project }} />);
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	get.mockReset();
	put.mockReset();
	seen.editor = seen.header = seen.files = seen.chat = null;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Editor for a viewer', () => {
	it('mounts the document read-only, with nothing that writes', async () => {
		serve('viewing', { grantedRole: 'viewer', effectiveRole: 'viewer' });
		const { findByTestId } = renderEditor('viewing');

		await findByTestId('markdown-editor');
		expect(seen.editor).toMatchObject({ readOnly: true, onAddComment: undefined, onReply: undefined, onToggleResolved: undefined });
		expect(seen.header).toMatchObject({ onRename: undefined, onCreateEpic: undefined, onLinkEpic: undefined });
		expect(seen.header?.onViewEpic).toBeTypeOf('function');
		expect(seen.files).toMatchObject({ readOnly: true, isOwner: false });
		expect(seen.chat).toMatchObject({ onApplyEdit: undefined });
	});

	it('opens the server copy instead of offering a local draft it couldn\'t save', async () => {
		serve('drafted', { grantedRole: 'editor', effectiveRole: 'viewer' });
		saveToLocalStorage('id-drafted', FILE, [{ type: 'paragraph', children: [{ text: 'unsaved' }] }], []);
		const { findByTestId, queryByTestId } = renderEditor('drafted');

		await findByTestId('markdown-editor');
		expect(queryByTestId('recovery-dialog')).toBeNull();
	});
});

describe('Editor for an editor', () => {
	it('mounts editable, with comments and the file actions', async () => {
		serve('editing', { grantedRole: 'editor', effectiveRole: 'editor' });
		const { findByTestId } = renderEditor('editing');

		await findByTestId('markdown-editor');
		expect(seen.editor).toMatchObject({ readOnly: false });
		expect(seen.editor?.onAddComment).toBeTypeOf('function');
		expect(seen.header?.onRename).toBeTypeOf('function');
		expect(seen.files).toMatchObject({ readOnly: false });
		expect(seen.chat?.onApplyEdit).toBeTypeOf('function');
	});

	it('offers to recover a local draft', async () => {
		serve('recovering', { grantedRole: 'editor', effectiveRole: 'editor' });
		saveToLocalStorage('id-recovering', FILE, [{ type: 'paragraph', children: [{ text: 'unsaved' }] }], []);
		const { findByTestId } = renderEditor('recovering');

		expect(await findByTestId('recovery-dialog')).toBeTruthy();
	});
});

describe('Editor on a local project', () => {
	it('tells a member the documents are on the owner\'s computer, in place of the tree', async () => {
		serve('local', { grantedRole: 'editor', effectiveRole: 'editor', storageMode: 'local', repository: {} });
		const { findByText, queryByTestId } = renderEditor('local');

		expect(await findByText("These documents live on Alice Ames's computer")).toBeTruthy();
		expect(queryByTestId('file-browser')).toBeNull();
		await waitFor(() => expect(get.mock.calls.some(([url]) => String(url).includes('/files'))).toBe(false));
	});

	it('gives the owner their files', async () => {
		serve('mine', { grantedRole: 'owner', effectiveRole: 'owner', storageMode: 'local' });
		const { findByTestId } = renderEditor('mine');

		expect(await findByTestId('file-browser')).toBeTruthy();
	});
});

describe('Editor saves the server refuses', () => {
	it('shows the server\'s reason, doesn\'t retry, and turns read-only', async () => {
		const roles = { grantedRole: 'editor', effectiveRole: 'editor' };
		serve('demoted', roles);
		const { findByTestId, findByText, queryByText } = renderEditor('demoted');
		await findByTestId('markdown-editor');
		expect(seen.editor).toMatchObject({ readOnly: false });

		// Demoted while the page was open; the next save is refused.
		Object.assign(roles, { grantedRole: 'viewer', effectiveRole: 'viewer' });
		put.mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, {
			error: 'You have view access to this project',
			reason: 'viewer',
		}));
		const model = seen.editor!.model as DocumentModel;
		act(() => model.set({ content: [{ type: 'paragraph', children: [{ text: 'An edit' }] }] }));
		// Switching files saves the dirty one first, without waiting on the autosave debounce.
		await act(async () => {
			await (seen.files!.onFileSelect as (path: string) => Promise<void>)('/docs/other.md');
		});

		expect(await findByText(/You have view access to this project/)).toBeTruthy();
		expect(queryByText(/Retrying automatically/)).toBeNull();
		expect(queryByText('Retry Now')).toBeNull();
		expect(put).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(seen.editor).toMatchObject({ readOnly: true }));
	});
});

describe('Editor and the version a draft is made against', () => {
	it('sends the base the file was opened with, even when the first save comes much later', async () => {
		serve('docs', { grantedRole: 'editor', effectiveRole: 'editor' });
		const files = get.getMockImplementation()!;
		get.mockImplementation(async (url: string) =>
			url.startsWith('/api/projects/acme/docs/files') ? { content: '# Spec\n\nBody', baseContentHash: 'v1' } : files(url)
		);
		put.mockResolvedValue({});
		const { findByTestId } = renderEditor('docs');
		await findByTestId('markdown-editor');

		const model = seen.editor!.model as DocumentModel;
		act(() => model.set({ content: [{ type: 'paragraph', children: [{ text: 'An edit' }] }] }));
		await act(async () => {
			await (seen.files!.onFileSelect as (path: string) => Promise<void>)('/docs/other.md');
		});

		expect(put).toHaveBeenCalledWith(
			'/api/projects/acme/docs/files?path=%2Fdocs%2Fspec.md',
			expect.objectContaining({ baseContentHash: 'v1' })
		);
	});

	it('restores a local copy with the base it was made against', async () => {
		serve('docs', { grantedRole: 'editor', effectiveRole: 'editor' });
		saveToLocalStorage('id-docs', FILE, [{ type: 'paragraph', children: [{ text: 'Local' }] }] as never, [], 'v0');
		const { findByTestId } = renderEditor('docs');
		await findByTestId('recovery-dialog');

		const { loadFromLocalStorage } = await import('@specboard/models');
		expect(loadFromLocalStorage('id-docs', FILE)?.baseContentHash).toBe('v0');
	});
});

