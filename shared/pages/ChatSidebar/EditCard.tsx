import type { JSX } from 'preact';
import { Button } from '@doc-platform/ui';
import type { EditStats } from './parseEdit';
import styles from './EditCard.module.css';

interface EditCardProps {
	stats: EditStats;
	onApply: () => void;
	isStreaming?: boolean;
	isApplied?: boolean;
}

/**
 * Card component that displays edit statistics and an apply button.
 * Shows the number of edits suggested, insertions/deletions, and match status.
 */
export function EditCard({ stats, onApply, isStreaming, isApplied }: EditCardProps): JSX.Element {
	const hasMatches = stats.matchedBlocks > 0;

	const handleClick = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		onApply();
	};

	return (
		<div class={`${styles.editCard} ${isApplied ? styles.applied : ''}`}>
			<div class={styles.header}>
				<span class={styles.title}>
					{isApplied
						? `${stats.matchedBlocks} edit${stats.matchedBlocks !== 1 ? 's' : ''} applied`
						: `${stats.totalBlocks} edit${stats.totalBlocks !== 1 ? 's' : ''} ${isStreaming ? 'generating...' : 'suggested'}`
					}
				</span>
				{!isStreaming && (
					<span class={styles.stats}>
						{stats.insertions > 0 && (
							<span class={styles.insertions}>+{stats.insertions}</span>
						)}
						{stats.deletions > 0 && (
							<span class={styles.deletions}>-{stats.deletions}</span>
						)}
					</span>
				)}
			</div>
			{!isStreaming && !isApplied && (
				<div class={styles.footer}>
					<span class={styles.status}>
						{stats.matchedBlocks} matched
						{stats.totalBlocks - stats.matchedBlocks > 0 && (
							<>, {stats.totalBlocks - stats.matchedBlocks} failed</>
						)}
					</span>
					<Button
						class={styles.applyButton}
						onClick={handleClick}
						disabled={!hasMatches}
						aria-label={`Apply ${stats.matchedBlocks} edit${stats.matchedBlocks !== 1 ? 's' : ''}`}
					>
						Apply{stats.matchedBlocks < stats.totalBlocks ? ` ${stats.matchedBlocks}` : ''}
					</Button>
				</div>
			)}
		</div>
	);
}
