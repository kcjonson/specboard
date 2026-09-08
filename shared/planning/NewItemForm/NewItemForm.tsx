import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import type { Status, ItemType } from '@specboard/models';
import { Button, DialogFooter, Select, Text } from '@specboard/ui';
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
	createType?: ItemType;
	/** Pre-set parent for the new item; the caller supplies it, the form passes it through. */
	parentKey?: string;
	onCreate: (data: NewItemData) => void;
}

/** Composes a new item. Existing items are viewed and edited by ItemView. */
export function NewItemForm({ createType, parentKey, onCreate }: NewItemFormProps): JSX.Element {
	const itemType: ItemType = createType || 'epic';
	const typeLabel = TYPE_LABELS[itemType];

	const [titleDraft, setTitleDraft] = useState('');
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(() => deserializeFromText(''));
	const [statusDraft, setStatusDraft] = useState<Status>('ready');

	const handleCreate = (): void => {
		if (!titleDraft.trim()) return;
		const descriptionText = serializeToText(descriptionAst);
		onCreate({
			title: titleDraft.trim(),
			description: descriptionText || undefined,
			status: statusDraft,
			type: itemType,
			...(parentKey ? { parentKey } : {}),
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

			<DialogFooter divider>
				<Button onClick={handleCreate} disabled={!titleDraft.trim()}>
					Create {typeLabel}
				</Button>
			</DialogFooter>
		</div>
	);
}
