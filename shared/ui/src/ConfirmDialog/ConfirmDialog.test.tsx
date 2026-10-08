/**
 * ConfirmDialog: holds itself busy while an async confirm runs, and shows a failure in
 * place (the server's message for a failed request) instead of closing on it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { FetchError } from '@specboard/fetch';
import { ConfirmDialog } from './ConfirmDialog';

const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
	// jsdom parses <dialog> but implements none of its methods, and Dialog is modal.
	HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
	HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = realShowModal;
	HTMLDialogElement.prototype.close = realClose;
});

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
	let resolve!: () => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('ConfirmDialog', () => {
	it('renders nothing while closed', () => {
		const { queryByRole } = render(
			<ConfirmDialog open={false} title="Remove?" onConfirm={vi.fn()} onCancel={vi.fn()} />
		);
		expect(queryByRole('dialog')).toBeNull();
	});

	it('holds both buttons while the confirm is pending, without taking focus off them', async () => {
		const pending = deferred();
		const onCancel = vi.fn();
		const { getByRole, findByRole, rerender } = render(
			<ConfirmDialog open title="Remove Sam?" confirmText="Remove" busyText="Removing..." onConfirm={vi.fn()} onCancel={onCancel} />
		);

		const onConfirm = vi.fn(() => pending.promise);
		rerender(<ConfirmDialog open title="Remove Sam?" confirmText="Remove" busyText="Removing..." onConfirm={onConfirm} onCancel={onCancel} />);
		const confirm = getByRole('button', { name: 'Remove' });
		confirm.focus();
		fireEvent.click(confirm);

		const busy = await findByRole('button', { name: 'Removing...' });
		expect(busy.getAttribute('aria-busy')).toBe('true');
		expect(busy.hasAttribute('disabled')).toBe(false);
		expect(document.activeElement).toBe(busy);
		fireEvent.click(busy);
		fireEvent.click(getByRole('button', { name: 'Cancel' }));
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onCancel).not.toHaveBeenCalled();

		pending.resolve();
		await waitFor(() => expect(getByRole('button', { name: 'Remove' }).getAttribute('aria-busy')).toBeNull());
	});

	it("shows the server's message when the confirm fails, and stays open", async () => {
		const onCancel = vi.fn();
		const onConfirm = vi.fn(async () => {
			throw new FetchError('HTTP 409: Conflict', 409, undefined, { error: "The project owner can't leave their own project" });
		});
		const { getByRole, findByRole } = render(
			<ConfirmDialog open title="Leave?" confirmText="Leave" onConfirm={onConfirm} onCancel={onCancel} />
		);

		fireEvent.click(getByRole('button', { name: 'Leave' }));

		expect((await findByRole('alert')).textContent).toBe("The project owner can't leave their own project");
		expect(onCancel).not.toHaveBeenCalled();
	});

	it('cancels', () => {
		const onCancel = vi.fn();
		const { getByRole } = render(<ConfirmDialog open title="Delete?" onConfirm={vi.fn()} onCancel={onCancel} />);

		fireEvent.click(getByRole('button', { name: 'Cancel' }));

		expect(onCancel).toHaveBeenCalledOnce();
	});
});
