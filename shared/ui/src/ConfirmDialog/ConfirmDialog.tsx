import { useEffect, useState } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { FetchError, fetchErrorText } from '@specboard/fetch';
import { Button } from '../Button/Button';
import { Dialog } from '../Dialog/Dialog';
import { DialogFooter } from '../DialogFooter/DialogFooter';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	/** What is about to happen. */
	message?: ComponentChildren;
	/** A literal value the action applies to, such as a path, set apart in monospace. */
	detail?: string;
	/** The consequence to weigh, shown in the error color. */
	warning?: string;
	confirmText?: string;
	/** The confirm button's text while onConfirm's promise is pending. */
	busyText?: string;
	cancelText?: string;
	/** Confirm button variant (default: "danger") */
	confirmVariant?: 'danger' | 'primary';
	/**
	 * Called on confirm. A returned promise holds the dialog busy, and a rejection is shown
	 * in the dialog (the server's message for a failed request). Closing it is the caller's
	 * call, by flipping `open`.
	 */
	onConfirm: () => void | Promise<void>;
	/** Called when cancelled or closed */
	onCancel: () => void;
}

function failureText(err: unknown): string {
	if (err instanceof FetchError) return fetchErrorText(err, 'That didn\'t work. Try again.');
	return err instanceof Error ? err.message : 'That didn\'t work. Try again.';
}

export function ConfirmDialog({
	open,
	title,
	message,
	detail,
	warning,
	confirmText = 'Confirm',
	busyText,
	cancelText = 'Cancel',
	confirmVariant = 'danger',
	onConfirm,
	onCancel,
}: ConfirmDialogProps): JSX.Element | null {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setBusy(false);
		setError(null);
	}, [open]);

	if (!open) return null;

	async function handleConfirm(): Promise<void> {
		if (busy) return;
		setError(null);
		const result = onConfirm();
		if (!result) return;
		setBusy(true);
		try {
			await result;
		} catch (err) {
			setError(failureText(err));
		} finally {
			setBusy(false);
		}
	}

	function handleCancel(): void {
		if (!busy) onCancel();
	}

	return (
		<Dialog open={true} onClose={handleCancel} title={title} maxWidth="sm">
			<div class={styles.content}>
				{message && <p class={styles.message}>{message}</p>}
				{detail && <p class={styles.detail}>{detail}</p>}
				{warning && <p class={styles.warning}>{warning}</p>}
				{error && <p class={styles.error} role="alert">{error}</p>}
				<DialogFooter>
					<Button onClick={handleCancel} class="secondary" busy={busy}>
						{cancelText}
					</Button>
					<Button onClick={handleConfirm} class={confirmVariant} busy={busy}>
						{busy && busyText ? busyText : confirmText}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
