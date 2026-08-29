import type { JSX } from 'preact';
import { Button, Dialog, DialogFooter } from '@specboard/ui';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Dialog title */
	title: string;
	/** Message to display */
	message?: string;
	/** Warning text (shown in red) */
	warning?: string;
	/** Confirm button text */
	confirmText?: string;
	/** Cancel button text */
	cancelText?: string;
	/** Confirm button variant (default: "danger") */
	confirmVariant?: 'danger' | 'primary';
	/** Called when confirmed */
	onConfirm: () => void;
	/** Called when cancelled or closed */
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	warning,
	confirmText = 'Confirm',
	cancelText = 'Cancel',
	confirmVariant = 'danger',
	onConfirm,
	onCancel,
}: ConfirmDialogProps): JSX.Element | null {
	if (!open) return null;

	return (
		<Dialog
			open={true}
			onClose={onCancel}
			title={title}
			maxWidth="sm"
		>
			<div class={styles.content}>
				{message && <p class={styles.message}>{message}</p>}
				{warning && <p class={styles.warning}>{warning}</p>}
				<DialogFooter>
					<Button onClick={onCancel} class="secondary">
						{cancelText}
					</Button>
					<Button onClick={onConfirm} class={confirmVariant}>
						{confirmText}
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
