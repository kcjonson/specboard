import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, BlockersCollection, type BlockerModel } from '@specboard/models';
import { Button, Text } from '@specboard/ui';
import styles from './BlockersSection.module.css';

export interface BlockersSectionProps {
	projectSlug: string;
	itemKey: string;
	/** Open a blocking item's detail (clicking an item blocker). */
	onOpenItem?: (itemKey: string) => void;
	/** Called after a blocker is added or cleared, so the parent can refresh derived state. */
	onChange?: () => void;
}

/**
 * Manages an item's open blockers: another item (auto-clears when it completes)
 * or free text (clears only when removed here). One input serves both — typed
 * input shaped like one of THIS project's item keys (SB-12) links that item,
 * anything else (other prefixes included) is a written reason.
 */
export function BlockersSection({ projectSlug, itemKey, onOpenItem, onChange }: BlockersSectionProps): JSX.Element {
	const blockers = useMemo(() => new BlockersCollection({ projectSlug, itemKey }), [projectSlug, itemKey]);
	useModel(blockers);

	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);

	// This item's own key carries the project prefix; only keys with the same
	// prefix are treated as item references.
	const keyPattern = useMemo(() => {
		const prefix = itemKey.split('-')[0] ?? '';
		return new RegExp(`^${prefix}-\\d+$`, 'i');
	}, [itemKey]);

	const handleAdd = useCallback(async (): Promise<void> => {
		const value = draft.trim();
		if (!value) return;
		setError(null);
		try {
			if (keyPattern.test(value)) {
				await blockers.add({ blockerKey: value.toUpperCase() });
			} else {
				await blockers.add({ text: value });
			}
			setDraft('');
			onChange?.();
		} catch {
			setError('Could not add that blocker — check the item key, or whether it already blocks this item.');
		}
	}, [blockers, draft, keyPattern, onChange]);

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			void handleAdd();
		} else if (e.key === 'Escape') {
			setDraft('');
		}
	};

	const handleClear = useCallback(async (blocker: BlockerModel): Promise<void> => {
		setError(null);
		try {
			await blockers.remove(blocker);
			onChange?.();
		} catch {
			setError('Could not clear that blocker.');
		}
	}, [blockers, onChange]);

	return (
		<section class={styles.section}>
			<h3 class={styles.sectionTitle}>Blocked by</h3>

			{blockers.length === 0 ? (
				<p class={styles.placeholder}>Nothing blocking this item</p>
			) : (
				<div class={styles.list} role="list">
					{blockers.map((blocker) => (
						<div key={blocker.id} class={styles.row} role="listitem">
							{blocker.type === 'item' ? (
								<>
									<span class={`${styles.badge} ${styles.item}`}>Item</span>
									<button
										type="button"
										class={styles.itemLink}
										onClick={() => blocker.blockerKey && onOpenItem?.(blocker.blockerKey)}
									>
										{blocker.blockerKey}
										{blocker.blockerTitle ? ` · ${blocker.blockerTitle}` : ''}
									</button>
								</>
							) : (
								<>
									<span class={`${styles.badge} ${styles.text}`}>Note</span>
									<span class={styles.reason}>{blocker.text}</span>
								</>
							)}
							<Button class="text" onClick={() => handleClear(blocker)}>
								Clear
							</Button>
						</div>
					))}
				</div>
			)}

			{error && <div class={styles.error}>{error}</div>}

			<div class={styles.addRow}>
				<Text
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
					placeholder="Item key (SB-12) or a reason..."
					ariaLabel="Add a blocker"
					compact
				/>
				<Button class="text" onClick={() => void handleAdd()} disabled={!draft.trim()}>
					+ Add
				</Button>
			</div>
		</section>
	);
}
