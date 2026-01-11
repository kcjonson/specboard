import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Badge, Button, Icon, Notice } from '@doc-platform/ui';
import type { GitStatusModel } from '@doc-platform/models';
import { CommitErrorBanner } from './CommitErrorBanner';
import styles from './GitStatusBar.module.css';

export interface GitStatusBarProps {
	gitStatus: GitStatusModel;
}

export function GitStatusBar({ gitStatus }: GitStatusBarProps): JSX.Element {
	const [showCommitInput, setShowCommitInput] = useState(false);
	const [commitMessage, setCommitMessage] = useState('');

	const handlePull = async (): Promise<void> => {
		await gitStatus.pull();
	};

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
			{/* Error banners */}
			{gitStatus.pullError && (
				<Notice variant="error" class={styles.errorNotice}>
					<span class={styles.errorText}>{gitStatus.pullError}</span>
					<Button onClick={handleDismiss} class="icon" aria-label="Dismiss error">
						<Icon name="x" class="size-sm" />
					</Button>
				</Notice>
			)}
			{gitStatus.commitError && (
				<CommitErrorBanner
					error={gitStatus.commitError}
					onRetry={handleRetry}
					onDismiss={handleDismiss}
				/>
			)}

			{/* Main bar */}
			<div class={styles.bar}>
				{/* Left: branch info */}
				<div class={styles.branchInfo}>
					<Icon name="git-branch" class="size-sm" />
					<span class={styles.branchName}>{gitStatus.branch || 'main'}</span>
				</div>

				{/* Right: actions */}
				<div class={styles.actions}>
					{/* Pull button with behind badge */}
					{gitStatus.behind > 0 && (
						<Badge class="variant-primary" title={`${gitStatus.behind} commits behind`}>
							{gitStatus.behind}
						</Badge>
					)}
					<Button
						onClick={handlePull}
						class="icon"
						disabled={gitStatus.pulling}
						aria-label={gitStatus.pulling ? 'Pulling...' : 'Pull latest'}
						title={gitStatus.pulling ? 'Pulling...' : 'Pull latest'}
					>
						<Icon name="download" />
					</Button>

					{/* Commit button */}
					{gitStatus.hasAnyChanges && (
						<>
							{showCommitInput ? (
								<div class={styles.commitInputContainer}>
									<input
										type="text"
										class={styles.commitInput}
										value={commitMessage}
										onInput={(e) => setCommitMessage((e.target as HTMLInputElement).value)}
										onKeyDown={handleCommitKeyDown}
										placeholder="Message (optional)"
										aria-label="Commit message"
										autoFocus
									/>
									<Button
										onClick={handleCommit}
										class="icon"
										disabled={gitStatus.committing}
										aria-label="Commit changes"
										title="Commit changes"
									>
										<Icon name="check" />
									</Button>
									<Button
										onClick={handleCancelCommit}
										class="icon"
										aria-label="Cancel commit"
										title="Cancel"
									>
										<Icon name="x" />
									</Button>
								</div>
							) : (
								<Button
									onClick={() => setShowCommitInput(true)}
									class="icon"
									disabled={gitStatus.committing}
									aria-label="Commit changes"
									title="Commit changes"
								>
									<Icon name="git-commit" />
								</Button>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
