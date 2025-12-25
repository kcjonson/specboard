import { useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { EpicModel, Status } from '@doc-platform/models';
import { EpicView } from '../epic/EpicView';
import styles from './EpicDialog.module.css';

/** Props for viewing/editing an existing epic */
interface EpicDialogExistingProps {
	epic: EpicModel;
	isNew?: false;
	onClose: () => void;
	onDelete?: (epic: EpicModel) => void;
	onCreate?: never;
}

/** Props for creating a new epic */
interface EpicDialogCreateProps {
	epic?: never;
	isNew: true;
	onClose: () => void;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status }) => void;
}

export type EpicDialogProps = EpicDialogExistingProps | EpicDialogCreateProps;

export function EpicDialog(props: EpicDialogProps): JSX.Element {
	const { onClose } = props;
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
				{props.isNew ? (
					<EpicView
						isNew
						onClose={onClose}
						onCreate={props.onCreate}
					/>
				) : (
					<EpicView
						epic={props.epic}
						onClose={onClose}
						onDelete={props.onDelete}
					/>
				)}
			</div>
		</div>
	);
}
