import type { JSX } from 'preact';
import { Dialog, Button } from '@specboard/ui';
import styles from './RecoveryDialog.module.css';

export interface RecoveryDialogProps {
	/** File path being recovered */
	filePath: string;
	/** Called when user chooses to restore cached changes */
	onRestore: () => void;
	/** Called when user chooses to discard cached changes */
	onDiscard: () => void;
}

export function RecoveryDialog({
	filePath,
	onRestore,
	onDiscard,
}: RecoveryDialogProps): JSX.Element {
	const fileName = filePath.split('/').pop() || filePath;

	return (
		<Dialog
			title="Restore unsaved changes?"
			onClose={onDiscard}
			maxWidth="sm"
		>
			<div class={styles.content}>
				<p class={styles.message}>
					Unsaved changes were found for <strong>{fileName}</strong>.
					Would you like to restore them?
				</p>
				<div class={styles.actions}>
					<Button onClick={onRestore} class={styles.restoreButton}>
						Restore
					</Button>
					<Button onClick={onDiscard} class={styles.discardButton}>
						Discard
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
