/**
 * The conflicts dialog: each conflicting draft with Compare, Keep mine, and Discard
 * mine, and the two versions side by side when compared.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import type { GitStatusModel } from '@specboard/models';
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

function gitStatus(): GitStatusModel {
	return {
		conflictedFiles: [
			{ path: '/docs/spec.md', status: 'modified', isUntracked: false, conflict: true },
			{ path: '/docs/old.md', status: 'deleted', isUntracked: false, conflict: true },
		],
		error: null,
		readCommitted: vi.fn(async () => '# Theirs'),
		readDraft: vi.fn(async () => '# Mine'),
		keepMine: vi.fn(async () => true),
		restore: vi.fn(async () => true),
	} as unknown as GitStatusModel;
}

describe('DraftConflictsDialog', () => {
	it('lists each conflicting draft with what the caller did to it', () => {
		const { getByText } = render(<DraftConflictsDialog open gitStatus={gitStatus()} onClose={vi.fn()} onResolved={vi.fn()} />);

		expect(getByText('/docs/spec.md')).toBeTruthy();
		expect(getByText('You edited it')).toBeTruthy();
		expect(getByText('You deleted it')).toBeTruthy();
	});

	it('shows the committed version beside the draft', async () => {
		const model = gitStatus();
		const { getAllByRole, getByText } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} onResolved={vi.fn()} />);

		fireEvent.click(getAllByRole('button', { name: 'Compare' })[0]!);

		await waitFor(() => expect(getByText('# Theirs')).toBeTruthy());
		expect(getByText('# Mine')).toBeTruthy();
		expect(model.readCommitted).toHaveBeenCalledWith('/docs/spec.md');
	});

	it('keeps or discards one file and reloads', async () => {
		const model = gitStatus();
		const onResolved = vi.fn();
		const { getAllByRole } = render(<DraftConflictsDialog open gitStatus={model} onClose={vi.fn()} onResolved={onResolved} />);

		fireEvent.click(getAllByRole('button', { name: 'Keep mine' })[0]!);
		await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
		fireEvent.click(getAllByRole('button', { name: 'Discard mine' })[1]!);
		await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(2));

		expect(model.keepMine).toHaveBeenCalledWith(['/docs/spec.md']);
		expect(model.restore).toHaveBeenCalledWith('/docs/old.md');
	});
});
