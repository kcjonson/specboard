import type { JSX } from 'preact';
import type { ItemType } from '@specboard/models';
import { Dialog } from '@specboard/ui';
import { NewItemForm, type NewItemData } from '../NewItemForm/NewItemForm';
import { TYPE_LABELS } from '../utils/itemType';

export interface NewItemDialogProps {
	createType?: ItemType;
	/** Pre-set parent for the new item, when creation was started from a parent's children. */
	parentKey?: string;
	onClose: () => void;
	onCreate: (data: NewItemData) => void;
}

/**
 * Centered modal for creating a new item. Creation is a focused, transient task
 * with no item id (so none of the drawer's resize/persistence/open-in-new-window
 * semantics apply), so it stays a modal while detail/edit uses the ItemDrawer.
 */
export function NewItemDialog({ createType, parentKey, onClose, onCreate }: NewItemDialogProps): JSX.Element {
	const title = `New ${TYPE_LABELS[createType || 'epic']}`;

	return (
		<Dialog onClose={onClose} title={title}>
			<NewItemForm createType={createType} parentKey={parentKey} onCreate={onCreate} />
		</Dialog>
	);
}
