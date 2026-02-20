import type { JSX } from 'preact';
import type { EpicModel, Status } from '@specboard/models';
import { Dialog, Icon } from '@specboard/ui';
import { EpicView } from '../EpicView/EpicView';
import styles from './EpicDialog.module.css';

/** Props for viewing/editing an existing epic */
interface EpicDialogExistingProps {
	epic: EpicModel;
	projectId: string;
	isNew?: false;
	onClose: () => void;
	onDelete?: (epic: EpicModel) => void;
	onCreate?: never;
}

/** Props for creating a new epic */
interface EpicDialogCreateProps {
	epic?: never;
	projectId?: never;
	isNew: true;
	onClose: () => void;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status }) => void;
}

export type EpicDialogProps = EpicDialogExistingProps | EpicDialogCreateProps;

export function EpicDialog(props: EpicDialogProps): JSX.Element {
	const { onClose } = props;

	const title = props.isNew ? 'New Epic' : 'Edit Epic';

	const handleOpenInNewWindow = (): void => {
		if (!props.isNew && props.epic && props.projectId) {
			window.open(`/projects/${props.projectId}/planning/epics/${props.epic.id}`, '_blank', 'noopener,noreferrer');
		}
	};

	const headerActions = !props.isNew ? (
		<button
			type="button"
			class={styles.openButton}
			onClick={handleOpenInNewWindow}
			aria-label="Open in new window"
			title="Open in new window"
		>
			<Icon name="external-link" class="size-lg" />
		</button>
	) : null;

	return (
		<Dialog onClose={onClose} title={title} headerActions={headerActions}>
			{props.isNew ? (
				<EpicView
					isNew
					onCreate={props.onCreate}
				/>
			) : (
				<EpicView
					epic={props.epic}
					onDelete={props.onDelete}
				/>
			)}
		</Dialog>
	);
}
