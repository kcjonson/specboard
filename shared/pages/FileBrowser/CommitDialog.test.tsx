/**
 * One commit request at a time: ⌘+Enter and a click landing together send one.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import type { GitStatusModel } from '@specboard/models';
import { CommitDialog } from './CommitDialog';

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

describe('CommitDialog', () => {
	it('sends one commit while one is in flight', async () => {
		let finish: () => void = () => {};
		const onCommit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
		const gitStatus = { changedFiles: [], committing: false } as unknown as GitStatusModel;
		const { getByRole } = render(<CommitDialog open gitStatus={gitStatus} onClose={vi.fn()} onCommit={onCommit} />);

		fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true });
		fireEvent.click(getByRole('button', { name: 'Committing...' }));

		expect(onCommit).toHaveBeenCalledTimes(1);
		finish();
		await waitFor(() => expect(getByRole('button', { name: 'Commit' })).toBeTruthy());
	});
});
