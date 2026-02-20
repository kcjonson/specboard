import type { JSX } from 'preact';
import { Button, Icon, Notice } from '@specboard/ui';
import type { CommitError } from '@specboard/models';
import styles from './CommitErrorBanner.module.css';

export interface CommitErrorBannerProps {
	error: CommitError;
	onRetry: () => void;
	onDismiss: () => void;
}

export function CommitErrorBanner({
	error,
	onRetry,
	onDismiss,
}: CommitErrorBannerProps): JSX.Element {
	const getTitle = (): string => {
		switch (error.stage) {
			case 'commit':
				return 'Commit failed';
			case 'push':
				return 'Push failed';
			case 'merge':
				return 'Merge failed';
			default:
				return 'Commit failed';
		}
	};

	const getDescription = (): string => {
		switch (error.stage) {
			case 'commit':
				return `Unable to commit changes: ${error.message}`;
			case 'push':
				return `Changes committed locally but push to remote failed: ${error.message}`;
			case 'merge':
				return `Changes pushed but merge to main failed: ${error.message}`;
			default:
				return error.message;
		}
	};

	const getActionLabel = (): string => {
		switch (error.stage) {
			case 'commit':
				return 'Try Again';
			case 'push':
				return 'Retry Push';
			case 'merge':
				return 'Dismiss';
			default:
				return 'Try Again';
		}
	};

	return (
		<Notice variant="error" class={styles.banner}>
			<div class={styles.content}>
				<strong>{getTitle()}</strong>
				<span class={styles.message}>{getDescription()}</span>
			</div>
			<div class={styles.actions}>
				{error.stage !== 'merge' && (
					<Button onClick={onRetry} class="secondary size-sm">
						{getActionLabel()}
					</Button>
				)}
				<Button onClick={onDismiss} class="icon" aria-label="Dismiss">
					<Icon name="x" class="size-sm" />
				</Button>
			</div>
		</Notice>
	);
}
