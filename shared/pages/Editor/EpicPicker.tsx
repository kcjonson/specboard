import { useState, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, ItemsCollection } from '@specboard/models';
import { Dialog, Text } from '@specboard/ui';
import styles from './EpicPicker.module.css';

/**
 * Rows loaded per status (so up to five times this on a board that big). The
 * picker has no show-more, and it exists to find an item to link, so reach
 * matters more than a light open: a linkable item past the window would just
 * be missing. Before windowing the picker loaded the first 1000 project-wide.
 */
const PICKER_LIMIT = 1000;

const STATUS_LABELS: Record<string, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	in_review: 'In Review',
	done: 'Done',
};

export interface EpicPickerProps {
	projectSlug: string;
	/** Called with the chosen epic's key (e.g. SB-345). */
	onSelect: (epicKey: string) => void;
	onClose: () => void;
}

/**
 * Modal listing the project's work items so the user can link the current
 * document to an existing one.
 */
export function EpicPicker({ projectSlug, onSelect, onClose }: EpicPickerProps): JSX.Element {
	// Per-status window; the picker's search only covers what is loaded.
	const items = useMemo(() => new ItemsCollection({ projectSlug, limit: PICKER_LIMIT }), [projectSlug]);
	useModel(items);

	const [search, setSearch] = useState('');
	const query = search.trim().toLowerCase();
	const matches = items
		.filter((item) => !query || item.title.toLowerCase().includes(query))
		.sort((a, b) => a.rank - b.rank);

	return (
		<Dialog onClose={onClose} title="Link to an existing item" maxWidth="md">
			<div class={styles.search}>
				<Text
					type="search"
					value={search}
					placeholder="Search items..."
					onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
				/>
			</div>
			<div class={styles.list} role="listbox">
				{matches.length === 0 ? (
					<p class={styles.empty}>No matching items</p>
				) : (
					matches.map((item) => (
						<button
							key={item.id}
							type="button"
							class={styles.row}
							role="option"
							onClick={() => onSelect(item.key)}
						>
							<span class={styles.title}>{item.title}</span>
							<span class={styles.status}>{STATUS_LABELS[item.status] ?? item.status}</span>
						</button>
					))
				)}
			</div>
		</Dialog>
	);
}
