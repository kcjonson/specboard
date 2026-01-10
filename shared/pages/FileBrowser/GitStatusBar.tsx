import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Badge, Button, Icon } from '@doc-platform/ui';
import type { GitStatusModel } from '@doc-platform/models';
import { CommitErrorBanner } from './CommitErrorBanner';
import styles from './GitStatusBar.module.css';

export interface GitStatusBarProps {
	gitStatus: GitStatusModel;
}

export function GitStatusBar({ gitStatus }: GitStatusBarProps): JSX.Element {
	const [showCommitInput, setShowCommitInput] = useState(false);
	const [commitMessage, setCommitMessage] = useState('');

	const handleCommit = async (): Promise<void> => {
		// Use custom message if provided, otherwise let server auto-generate
		const message = commitMessage.trim() || undefined;
		await gitStatus.commit(message);

		// Reset state on success
		if (!gitStatus.commitError) {
			setShowCommitInput(false);
			setCommitMessage('');
		}
	};

	const handleCommitKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleCommit();
		} else if (e.key === 'Escape') {
			setShowCommitInput(false);
			setCommitMessage('');
		}
	};

	const handleRetry = (): void => {
		handleCommit();
	};

	const handleDismiss = (): void => {
		gitStatus.clearErrors();
	};

	const handleCancelCommit = (): void => {
		setShowCommitInput(false);
		setCommitMessage('');
	};

	return (
		<div class={styles.container}>
			{gitStatus.commitError && (
				<CommitErrorBanner
					error={gitStatus.commitError}
					onRetry={handleRetry}
					onDismiss={handleDismiss}
				/>
			)}
			<div class={styles.bar}>
				<div class={styles.branchInfo}>
					<Icon name="git-branch" class="size-sm" />
					<span class={styles.branchName}>{gitStatus.branch || 'main'}</span>
					{gitStatus.changedCount > 0 && (
						<Badge class="variant-warning size-sm">{gitStatus.changedCount}</Badge>
					)}
				</div>
				{gitStatus.hasAnyChanges && (
					<div class={styles.actions}>
						{showCommitInput ? (
							<div class={styles.commitInputContainer}>
								<input
									type="text"
									class={styles.commitInput}
									value={commitMessage}
									onInput={(e) => setCommitMessage((e.target as HTMLInputElement).value)}
									onKeyDown={handleCommitKeyDown}
									placeholder="Commit message (optional)"
									aria-label="Commit message"
									autoFocus
								/>
								<Button
									onClick={handleCommit}
									class="size-sm"
									disabled={gitStatus.committing}
								>
									{gitStatus.committing ? 'Committing...' : 'Commit'}
								</Button>
								<Button
									onClick={handleCancelCommit}
									class="icon"
									aria-label="Cancel commit"
								>
									<Icon name="x" class="size-sm" />
								</Button>
							</div>
						) : (
							<Button
								onClick={() => setShowCommitInput(true)}
								class="size-sm"
								disabled={gitStatus.committing}
							>
								<Icon name="git-commit" class="size-sm" />
								Commit
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
