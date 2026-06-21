import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, Select } from '@specboard/ui';
import type { SpecType } from '@specboard/models';
import { FileBrowser } from '@specboard/pages';
import styles from './FilePicker.module.css';

const TYPE_OPTIONS: { value: SpecType; label: string }[] = [
	{ value: 'product', label: 'Product' },
	{ value: 'technical', label: 'Technical' },
];

export interface FilePickerProps {
	projectId: string;
	/** Called with the chosen file path and spec type. */
	onSelect: (path: string, type: SpecType) => void;
	onClose: () => void;
}

/**
 * Modal that lets the user choose a markdown document and a spec type, then
 * links it. Reuses the project's FileBrowser (markdown-only) for selection.
 */
export function FilePicker({ projectId, onSelect, onClose }: FilePickerProps): JSX.Element {
	const [type, setType] = useState<SpecType>('product');

	return (
		<Dialog onClose={onClose} title="Link a spec document" maxWidth="md">
			<div class={styles.controls}>
				<Select
					value={type}
					options={TYPE_OPTIONS}
					onChange={(e) => setType((e.target as HTMLSelectElement).value as SpecType)}
					label="Spec type"
				/>
				<p class={styles.hint}>Choose a document to link as a {type} spec.</p>
			</div>
			<div class={styles.browser}>
				<FileBrowser projectId={projectId} onFileSelect={(path) => onSelect(path, type)} />
			</div>
		</Dialog>
	);
}
