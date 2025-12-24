import { useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { EpicModel } from '@doc-platform/models';
import { EpicView } from '../epic/EpicView';
import styles from './EpicDialog.module.css';

interface EpicDialogProps {
	epic: EpicModel;
	onClose: () => void;
	onDelete?: (epic: EpicModel) => void;
}

export function EpicDialog({ epic, onClose, onDelete }: EpicDialogProps): JSX.Element {
	// Handle escape key
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		},
		[onClose]
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		// Prevent body scroll when dialog is open
		document.body.style.overflow = 'hidden';

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.body.style.overflow = '';
		};
	}, [handleKeyDown]);

	// Handle backdrop click
	const handleBackdropClick = (e: MouseEvent): void => {
		if (e.target === e.currentTarget) {
			onClose();
		}
	};

	return (
		<div
			class={styles.backdrop}
			onClick={handleBackdropClick}
			role="dialog"
			aria-modal="true"
			aria-labelledby="epic-dialog-title"
		>
			<div class={styles.dialog}>
				<EpicView epic={epic} onClose={onClose} onDelete={onDelete} />
			</div>
		</div>
	);
}
