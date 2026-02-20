import type { JSX } from 'preact';
import { Badge, Button, Icon, Notice } from '@specboard/ui';
import type { GitStatusModel } from '@specboard/models';
import styles from './PullButton.module.css';

export interface PullButtonProps {
	gitStatus: GitStatusModel;
}

export function PullButton({ gitStatus }: PullButtonProps): JSX.Element {
	const handlePull = async (): Promise<void> => {
		await gitStatus.pull();
	};

	const handleDismissError = (): void => {
		gitStatus.clearErrors();
	};

	return (
		<div class={styles.container}>
			{gitStatus.pullError && (
				<Notice variant="error" class={styles.errorNotice}>
					<span class={styles.errorText}>{gitStatus.pullError}</span>
					<Button
						onClick={handleDismissError}
						class="icon"
						aria-label="Dismiss error"
					>
						<Icon name="x" class="size-sm" />
					</Button>
				</Notice>
			)}
			<div class={styles.buttonContainer}>
				<Button
					onClick={handlePull}
					class={`secondary size-sm ${styles.pullButton}`}
					disabled={gitStatus.pulling}
				>
					<Icon name="download" class="size-sm" />
					{gitStatus.pulling ? 'Pulling...' : 'Pull Latest'}
				</Button>
				{gitStatus.behind > 0 && (
					<Badge class="variant-primary size-sm" title={`${gitStatus.behind} commits behind`}>
						{gitStatus.behind}
					</Badge>
				)}
			</div>
		</div>
	);
}
