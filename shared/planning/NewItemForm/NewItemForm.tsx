import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import type { Status, ItemType } from '@specboard/models';
import { Button, DialogFooter, Select, Text } from '@specboard/ui';
import { ItemPicker } from '@specboard/pages';
import { RichTextEditor, serializeToText, deserializeFromText } from '../RichTextEditor';
import { TYPE_LABELS } from '../utils/itemType';
import styles from './NewItemForm.module.css';

// Creating an item already blocked or in review makes no sense; those states are entered later.
const STATUS_OPTIONS: { value: Status; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

export interface NewItemData {
	title: string;
	description?: string;
	status: Status;
	type?: ItemType;
	parentKey?: string;
}

export interface NewItemFormProps {
	projectSlug: string;
	createType?: ItemType;
	/** Parent the form opens with; the user can change or clear it before creating. */
	parentKey?: string;
	onCreate: (data: NewItemData) => void;
}

/** Composes a new item. Existing items are viewed and edited by ItemView. */
export function NewItemForm({ projectSlug, createType, parentKey, onCreate }: NewItemFormProps): JSX.Element {
	const itemType: ItemType = createType || 'epic';
	const typeLabel = TYPE_LABELS[itemType];

	const [titleDraft, setTitleDraft] = useState('');
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(() => deserializeFromText(''));
	const [statusDraft, setStatusDraft] = useState<Status>('ready');
	// Creation takes the parent as part of the payload (a different write path from
	// ItemModel.move, which only exists once the item does), so this is a draft.
	const [parentDraft, setParentDraft] = useState<string | undefined>(parentKey);
	const [parentPickerOpen, setParentPickerOpen] = useState(false);

	const chooseParent = (next: string | undefined): void => {
		setParentDraft(next);
		setParentPickerOpen(false);
	};

	const handleCreate = (): void => {
		if (!titleDraft.trim()) return;
		const descriptionText = serializeToText(descriptionAst);
		onCreate({
			title: titleDraft.trim(),
			description: descriptionText || undefined,
			status: statusDraft,
			type: itemType,
			...(parentDraft ? { parentKey: parentDraft } : {}),
		});
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<div class={styles.titleField}>
					<Text
						id="new-item-title"
						value={titleDraft}
						onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
						placeholder={`${typeLabel} title...`}
						label="Title"
					/>
				</div>
				<div class={styles.fields}>
					<div class={styles.field}>
						<Select
							id="new-item-status"
							value={statusDraft}
							options={STATUS_OPTIONS}
							onChange={(e) => setStatusDraft((e.target as HTMLSelectElement).value as Status)}
							label="Status"
						/>
					</div>
					<div class={styles.field}>
						{/* Not a <label>: the parent is displayed text plus a button, not a
						    form control, and a label with nothing to point at announces nothing. */}
						<span class={styles.fieldLabel}>Parent</span>
						<span class={styles.fieldValue}>{parentDraft || 'None'}</span>
						<button
							type="button"
							class={styles.inlineLink}
							onClick={() => setParentPickerOpen(true)}
							aria-label="Change parent"
						>
							Change
						</button>
					</div>
				</div>
			</div>

			<section class={styles.section}>
				<h3 class={styles.sectionTitle}>Description</h3>
				<RichTextEditor
					value={descriptionAst}
					onChange={setDescriptionAst}
					placeholder="Add a description..."
				/>
			</section>

			{parentPickerOpen && (
				<ItemPicker
					projectSlug={projectSlug}
					title="Choose a parent"
					// A UI choice, not a model rule: the schema puts no type restriction on
					// parenting (a task under a bug, an epic under an epic all validate, on
					// create and on move). Offering only epics keeps the ordinary shape
					// obvious — do not "fix" the model to match this.
					type="epic"
					clearOption={parentDraft ? { label: 'No parent', onSelect: () => chooseParent(undefined) } : undefined}
					onSelect={chooseParent}
					onClose={() => setParentPickerOpen(false)}
				/>
			)}

			<DialogFooter divider>
				<Button onClick={handleCreate} disabled={!titleDraft.trim()}>
					Create {typeLabel}
				</Button>
			</DialogFooter>
		</div>
	);
}
