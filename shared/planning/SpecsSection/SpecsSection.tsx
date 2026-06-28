import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { useModel, SpecsCollection, type SpecModel } from '@specboard/models';
import { Button } from '@specboard/ui';
import { FilePicker } from '../FilePicker/FilePicker';
import styles from './SpecsSection.module.css';

const TYPE_LABELS: Record<string, string> = {
	product: 'Product',
	technical: 'Technical',
};

export interface SpecsSectionProps {
	projectId: string;
	itemId: string;
}

/**
 * Manages a work item's typed spec links: lists them (grouped by a type badge),
 * lets the user add a link via the file picker, and remove links. Backed by a
 * SpecsCollection whose add()/remove() persist to the API.
 */
export function SpecsSection({ projectId, itemId }: SpecsSectionProps): JSX.Element {
	const specs = useMemo(() => new SpecsCollection({ projectId, itemId }), [projectId, itemId]);
	useModel(specs);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = useCallback(async (path: string, type: 'product' | 'technical'): Promise<void> => {
		setPickerOpen(false);
		setError(null);
		try {
			await specs.add({ path, type });
		} catch {
			setError('Could not link that document — it may already be linked.');
		}
	}, [specs]);

	const handleRemove = useCallback(async (spec: SpecModel): Promise<void> => {
		setError(null);
		try {
			await specs.remove(spec);
		} catch {
			setError('Could not remove that link.');
		}
	}, [specs]);

	const openSpec = useCallback((path: string): void => {
		navigate(`/projects/${projectId}/pages?file=${encodeURIComponent(path)}`);
	}, [projectId]);

	return (
		<section class={styles.section}>
			<h3 class={styles.sectionTitle}>Specifications</h3>

			{specs.length === 0 ? (
				<p class={styles.placeholder}>No specifications linked</p>
			) : (
				<div class={styles.list} role="list">
					{specs.map((spec) => (
						<div key={spec.id} class={styles.row} role="listitem">
							<span class={`${styles.badge} ${styles[spec.type]}`}>{TYPE_LABELS[spec.type] ?? spec.type}</span>
							<button type="button" class={styles.specLink} onClick={() => openSpec(spec.path)}>
								{spec.path}
							</button>
							<Button class="text" onClick={() => handleRemove(spec)}>
								Remove
							</Button>
						</div>
					))}
				</div>
			)}

			{error && <div class={styles.error}>{error}</div>}

			<div class={styles.addRow}>
				<Button class="text" onClick={() => setPickerOpen(true)}>
					+ Link spec
				</Button>
			</div>

			{pickerOpen && (
				<FilePicker
					projectId={projectId}
					onSelect={handleAdd}
					onClose={() => setPickerOpen(false)}
				/>
			)}
		</section>
	);
}
