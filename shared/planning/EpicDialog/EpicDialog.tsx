import type { JSX } from 'preact';
import type { EpicModel, Status } from '@doc-platform/models';
import { Dialog } from '@doc-platform/ui';
import { EpicView } from '../EpicView/EpicView';

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

	return (
		<Dialog onClose={onClose}>
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
		</Dialog>
	);
}
