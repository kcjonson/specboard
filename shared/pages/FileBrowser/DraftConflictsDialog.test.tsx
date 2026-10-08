/**
 * The conflicts dialog: each conflicting draft with Compare, keep, and discard (behind
 * a confirmation), named for screen readers with its path; the two versions side by
 * side when compared, with no stale answer under the wrong row; and focus moving on to
 * the next row when one resolves.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import type { ChangedFile, GitStatusModel } from '@specboard/models';
import { DraftConflictsDialog } from './DraftConflictsDialog';

// jsdom has no <dialog> modal support.
const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
});
afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

/** A model whose conflict list shrinks as rows are kept or discarded. */
function gitStatus(): GitStatusModel & { files: ChangedFile[] } {
	const model = {
		files: [
			{ path: '/docs/spec.md', status: 'modified', isUntracked: false, conflict: true },
			{ path: '/docs/old.md', status: 'deleted', isUntracked: false, conflict: true, renamedTo: '/docs/new.md' },
		] as ChangedFile[],
		get conflictedFiles(): ChangedFile[] {
			return this.files;
		},
		error: null,
		readCommitted: vi.fn(async (path: string) => `# Theirs ${path}`),
		readDraft: vi.fn(async (path: string) => `# Mine ${path}`),
		keepMine: vi.fn(async (paths: string[]) => {
			model.files = model.files.filter((f) => !paths.includes(f.path));
			return true;
		}),
		restore: vi.fn(async () => true),
		undoRename: vi.fn(async (oldPath: string) => {
			model.files = model.files.filter((f) => f.path !== oldPath);
			return true;
		}),
	};
	return model as unknown as GitStatusModel & { files: ChangedFile[] };
}

describe('DraftConflictsDialog', () => {
	it('names each row\'s actions with its path, and says when a deletion was a rename', () => {
		const { getByRole, getByText } = render(<DraftConflictsDialog open gitStatus={gitStatus()} onClose={vi.fn()} />);

		expect(getByText('You edited it')).toBeTruthy();
		expect(getByText('You renamed it to /docs/new.md')).toBeTruthy();
		expect(getByRole('button', { name: 'Keep mine: /docs/spec.md' })).toBeTruthy();
		expect(getByRole('button', { name: 'Keep my rename: /docs/old.md' })).toBeTruthy();
		expect(getByRole('button', { name: 'Undo my rename: /docs/old.md' })).toBeTruthy();
	});

	it('shows the committed version beside the draft, and says the region is open', async () => {
		const model = gitStatus();
		const { getByRole, getByText } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} />);
		const compare = getByRole('button', { name: 'Compare versions of /docs/spec.md' });
		expect(compare.getAttribute('aria-expanded')).toBe('false');

		fireEvent.click(compare);

		await waitFor(() => expect(getByText('# Theirs /docs/spec.md')).toBeTruthy());
		expect(getByText('# Mine /docs/spec.md')).toBeTruthy();
		expect(compare.getAttribute('aria-expanded')).toBe('true');
		expect(document.getElementById(compare.getAttribute('aria-controls')!)).toBeTruthy();
	});

	it('drops a compare answer that arrives after another row was opened', async () => {
		const model = gitStatus();
		let releaseFirst: (value: string) => void = () => {};
		vi.mocked(model.readCommitted).mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }));
		const { getByRole, getByText, queryByText } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} />);

		fireEvent.click(getByRole('button', { name: 'Compare versions of /docs/spec.md' }));
		fireEvent.click(getByRole('button', { name: 'Compare versions of /docs/old.md' }));
		await waitFor(() => expect(getByText('# Theirs /docs/old.md')).toBeTruthy());
		releaseFirst('# Stale');

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(queryByText('# Stale')).toBeNull();
	});

	it('keeps a draft, reloads that path, and moves focus to the next row', async () => {
		const model = gitStatus();
		const onBeforeResolve = vi.fn(async () => {});
		const onResolved = vi.fn();
		const { getByRole } = render(
			<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} onBeforeResolve={onBeforeResolve} onResolved={onResolved} />
		);

		fireEvent.click(getByRole('button', { name: 'Keep mine: /docs/spec.md' }));

		await waitFor(() => expect(onResolved).toHaveBeenCalledWith('/docs/spec.md'));
		expect(onBeforeResolve).toHaveBeenCalledWith('/docs/spec.md');
		expect(model.keepMine).toHaveBeenCalledWith(['/docs/spec.md']);
		await waitFor(() => expect(document.activeElement).toBe(getByRole('button', { name: 'Compare versions of /docs/old.md' })));
	});

	it('asks before discarding, undoes a rename, and puts focus on Close when none are left', async () => {
		const model = gitStatus();
		model.files = model.files.slice(1);
		const onRenameUndone = vi.fn();
		const { getByRole, findByRole } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} onRenameUndone={onRenameUndone} />);

		fireEvent.click(getByRole('button', { name: 'Undo my rename: /docs/old.md' }));
		expect(model.undoRename).not.toHaveBeenCalled();
		fireEvent.click(await findByRole('button', { name: 'Undo my rename' }));

		await waitFor(() => expect(model.undoRename).toHaveBeenCalledWith('/docs/old.md', '/docs/new.md'));
		await waitFor(() => expect(onRenameUndone).toHaveBeenCalledWith('/docs/old.md', '/docs/new.md'));
		// The footer's Close (the header's X is also named Close).
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Close'));
	});

	it('compares a rename\'s source as committed with the draft at its new path', async () => {
		const model = gitStatus();
		const { getByRole, getByText } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} />);

		fireEvent.click(getByRole('button', { name: 'Compare versions of /docs/old.md' }));

		await waitFor(() => expect(getByText('# Theirs /docs/old.md')).toBeTruthy());
		expect(getByText('# Mine /docs/new.md')).toBeTruthy();
		expect(getByText('Your draft at /docs/new.md')).toBeTruthy();
	});

	it('lets two rows resolve at once, each clearing only its own busy state', async () => {
		const model = gitStatus();
		let finishFirst: (value: boolean) => void = () => {};
		vi.mocked(model.keepMine).mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
		vi.mocked(model.keepMine).mockImplementationOnce(() => new Promise(() => {}));
		const { getByRole } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} />);

		fireEvent.click(getByRole('button', { name: 'Keep mine: /docs/spec.md' }));
		fireEvent.click(getByRole('button', { name: 'Keep my rename: /docs/old.md' }));
		await waitFor(() => expect(getByRole('button', { name: 'Keep my rename: /docs/old.md' }).getAttribute('aria-busy')).toBe('true'));
		finishFirst(false);

		await waitFor(() => expect(getByRole('button', { name: 'Keep mine: /docs/spec.md' }).getAttribute('aria-busy')).toBeNull());
		expect(getByRole('button', { name: 'Keep my rename: /docs/old.md' }).getAttribute('aria-busy')).toBe('true');
	});

	it('marks only the row being resolved as busy', async () => {
		const model = gitStatus();
		vi.mocked(model.keepMine).mockImplementationOnce(() => new Promise(() => {}));
		const { getByRole } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} />);

		fireEvent.click(getByRole('button', { name: 'Keep mine: /docs/spec.md' }));

		await waitFor(() => expect(getByRole('button', { name: 'Keep mine: /docs/spec.md' }).getAttribute('aria-busy')).toBe('true'));
		expect(getByRole('button', { name: 'Keep my rename: /docs/old.md' }).getAttribute('aria-busy')).toBeNull();
	});
});
