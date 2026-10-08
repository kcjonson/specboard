import { useState, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Badge, Button, ConfirmDialog, Icon, Notice } from '@specboard/ui';
import type { GitStatusModel } from '@specboard/models';
import { CommitErrorBanner } from './CommitErrorBanner';
import { CommitDialog } from './CommitDialog';
import styles from './GitStatusBar.module.css';

export interface GitStatusBarProps {
	gitStatus: GitStatusModel;
	/** Whether the editor has unsaved changes */
	hasUnsavedChanges?: boolean;
	/** Called before pull starts - use to save dirty content. */
	onBeforePull?: () => Promise<void>;
	/** Called after a successful pull completes */
	onPullComplete?: () => void | Promise<void>;
}

export function GitStatusBar({ gitStatus, hasUnsavedChanges, onBeforePull, onPullComplete }: GitStatusBarProps): JSX.Element {
	const [showCommitDialog, setShowCommitDialog] = useState(false);
	const [showPullConfirm, setShowPullConfirm] = useState(false);
	// Track last commit message for retry scenarios
	const lastCommitMessageRef = useRef<string>('');

	const executePull = async (): Promise<void> => {
		if (onBeforePull) {
			await onBeforePull();
		}
		const result = await gitStatus.pull();
		if (result.success) {
			await onPullComplete?.();
		}
	};

	const handlePullClick = (): void => {
		if (hasUnsavedChanges) {
			setShowPullConfirm(true);
		} else {
			executePull();
		}
	};

	const handlePullConfirm = (): void => {
		setShowPullConfirm(false);
		executePull();
	};

	const handleCommit = async (message?: string): Promise<void> => {
		// Store the message for potential retry
		lastCommitMessageRef.current = message || '';
		await gitStatus.commit(message);

		// Close dialog and clear stored message on success
		if (!gitStatus.commitError) {
			setShowCommitDialog(false);
			lastCommitMessageRef.current = '';
		}
	};

	const handleRetry = (): void => {
		// Open dialog - it will use initialMessage prop to restore previous message
		setShowCommitDialog(true);
	};

	const handleDismiss = (): void => {
		gitStatus.clearErrors();
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
						onClick={handlePullClick}
						class="icon"
						disabled={gitStatus.pulling}
						aria-label={gitStatus.pulling ? 'Pulling...' : 'Pull latest'}
						title={gitStatus.pulling ? 'Pulling...' : 'Pull latest'}
					>
						<Icon
							name="download"
							class={gitStatus.pulling ? styles.pulling : undefined}
						/>
					</Button>

					{/* Commit button - always visible, disabled when no changes */}
					<Button
						onClick={() => setShowCommitDialog(true)}
						class="icon"
						disabled={gitStatus.committing || !gitStatus.hasAnyChanges}
						aria-label="Commit changes"
						title={gitStatus.hasAnyChanges ? 'Commit changes' : 'No changes to commit'}
					>
						<Icon name="git-commit" />
					</Button>
				</div>
			</div>

			{/* Commit dialog */}
			<CommitDialog
				open={showCommitDialog}
				gitStatus={gitStatus}
				onClose={() => setShowCommitDialog(false)}
				onCommit={handleCommit}
				initialMessage={lastCommitMessageRef.current}
			/>

			{/* Pull confirmation when there are unsaved changes */}
			<ConfirmDialog
				open={showPullConfirm}
				title="Unsaved changes"
				message="You have unsaved changes in the editor. Pulling will save your changes first, then update with the latest from remote."
				warning="If someone else edited the same file, your changes may need to be merged."
				confirmText="Save & Pull"
				confirmVariant="primary"
				cancelText="Cancel"
				onConfirm={handlePullConfirm}
				onCancel={() => setShowPullConfirm(false)}
			/>
		</div>
	);
}
