import type { JSX } from 'preact';
import type { ItemModel, Status, ItemType } from '@specboard/models';
import { Dialog, Icon } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import styles from './ItemDialog.module.css';

const TYPE_LABELS: Record<ItemType, string> = {
	epic: 'Epic',
	chore: 'Chore',
	bug: 'Bug',
};

/** Props for viewing/editing an existing item */
interface ItemDialogExistingProps {
	item: ItemModel;
	projectId: string;
	isNew?: false;
	createType?: never;
	onClose: () => void;
	onDelete?: (item: ItemModel) => void;
	onCreate?: never;
}

/** Props for creating a new item */
interface ItemDialogCreateProps {
	item?: never;
	projectId?: never;
	isNew: true;
	createType?: ItemType;
	onClose: () => void;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status; type?: ItemType }) => void;
}

export type ItemDialogProps = ItemDialogExistingProps | ItemDialogCreateProps;

export function ItemDialog(props: ItemDialogProps): JSX.Element {
	const { onClose } = props;

	const title = props.isNew
		? `New ${TYPE_LABELS[props.createType || 'epic']}`
		: `Edit ${TYPE_LABELS[props.item.type || 'epic']}`;

	const handleOpenInNewWindow = (): void => {
		if (!props.isNew && props.item && props.projectId) {
			window.open(`/projects/${props.projectId}/planning/items/${props.item.id}`, '_blank', 'noopener,noreferrer');
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
				<ItemView
					isNew
					createType={props.createType}
					onCreate={props.onCreate}
				/>
			) : (
				<ItemView
					item={props.item}
					onDelete={props.onDelete}
				/>
			)}
		</Dialog>
	);
}
