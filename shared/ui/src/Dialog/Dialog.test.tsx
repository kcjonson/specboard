/**
 * Dialog - modal wrapper over the native <dialog> element
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Dialog } from './Dialog';

// Same stubbing ItemPicker.test.tsx does, for the same reason and with the same
// lifetime: captured at module load so a restore can't put our own stubs back, and
// restored once at the end because testing-library's cleanup unmounts between tests
// and Dialog closes itself on unmount. Per-file is the isolation that matters — the
// leak worth preventing is into other files sharing this worker.
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

/** The dialog inside an ancestor that closes on Escape, the way the item drawer wraps it. */
function renderInDrawer(onAncestorKeyDown: (e: KeyboardEvent) => void, onClose = vi.fn()): {
	dialog: HTMLDialogElement;
	onClose: ReturnType<typeof vi.fn>;
} {
	const { container } = render(
		<div onKeyDown={onAncestorKeyDown}>
			<Dialog onClose={onClose} title="Link a spec document">
				<button type="button">Pick</button>
			</Dialog>
		</div>
	);
	const dialog = container.querySelector('dialog');
	if (!(dialog instanceof HTMLDialogElement)) throw new Error('Dialog did not render a <dialog>');
	return { dialog, onClose };
}

describe('Dialog', () => {
	// A dialog opened from the item drawer is inside the drawer's subtree, so a
	// bubbling Escape reached the drawer's own handler and closed both at once.
	it('keeps Escape from reaching an ancestor that also closes on it', () => {
		const ancestor = vi.fn();
		const { dialog } = renderInDrawer(ancestor);

		fireEvent.keyDown(dialog.querySelector('button') as HTMLButtonElement, { key: 'Escape' });

		expect(ancestor).not.toHaveBeenCalled();
	});

	it('lets other keys through to the ancestor', () => {
		const ancestor = vi.fn();
		const { dialog } = renderInDrawer(ancestor);

		fireEvent.keyDown(dialog.querySelector('button') as HTMLButtonElement, { key: 'Enter' });

		expect(ancestor).toHaveBeenCalledTimes(1);
	});

	// Escape reaches the element as `cancel` by a separate route from the keydown,
	// so swallowing the keydown must not cost the dialog its own dismissal.
	it('still closes itself on Escape', () => {
		const onClose = vi.fn();
		const { dialog } = renderInDrawer(vi.fn(), onClose);

		const cancel = new Event('cancel', { cancelable: true });
		dialog.dispatchEvent(cancel);

		expect(onClose).toHaveBeenCalledTimes(1);
		// The consumer owns `open`, so the element must stay put until it re-renders.
		expect(cancel.defaultPrevented).toBe(true);
	});
});
