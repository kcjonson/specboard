import type { JSX } from 'preact';
import type { Status, ItemType } from '@specboard/models';
import { Dialog } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';

const TYPE_LABELS: Record<ItemType, string> = {
	epic: 'Epic',
	bug: 'Bug',
};

export interface NewItemDialogProps {
	createType?: ItemType;
	onClose: () => void;
	onCreate: (data: { title: string; description?: string; status: Status; type?: ItemType }) => void;
}

/**
 * Centered modal for creating a new item. Creation is a focused, transient task
 * with no item id (so none of the drawer's resize/persistence/open-in-new-window
 * semantics apply), so it stays a modal while detail/edit uses the ItemDrawer.
 * The body is the same shared {@link ItemView}, here in create mode.
 */
export function NewItemDialog({ createType, onClose, onCreate }: NewItemDialogProps): JSX.Element {
	const title = `New ${TYPE_LABELS[createType || 'epic']}`;

	return (
		<Dialog onClose={onClose} title={title}>
			<ItemView isNew createType={createType} onCreate={onCreate} />
		</Dialog>
	);
}
