import { useState, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Badge, Button, ConfirmDialog, Icon, Notice } from '@specboard/ui';
import type { GitStatusModel } from '@specboard/models';
import { CommitErrorBanner } from './CommitErrorBanner';
import { CommitDialog } from './CommitDialog';
import { DraftConflictsDialog } from './DraftConflictsDialog';
import styles from './GitStatusBar.module.css';

export interface GitStatusBarProps {
	gitStatus: GitStatusModel;
	/** Whether the editor has unsaved changes */
	hasUnsavedChanges?: boolean;
	/** Called before pull starts - use to save dirty content. */
	onBeforePull?: () => Promise<void>;
	/** Called after a successful pull completes */
	onPullComplete?: () => void | Promise<void>;
	/** Called before a commit, to save the open document */
	onBeforeCommit?: () => Promise<void>;
	/** Called when a commit attempt ends, landed or not */
	onAfterCommit?: (committed: boolean) => void | Promise<void>;
	/** Called before a draft conflict on this path is kept or discarded */
	onBeforeResolveDraft?: (path: string) => Promise<void>;
	/** Called after a draft conflict on this path was kept or discarded */
	onDraftResolved?: (path: string) => void | Promise<void>;
	/** Called after a rename was undone, the file back at oldPath */
	onRenameUndone?: (oldPath: string, newPath: string) => void | Promise<void>;
}

export function GitStatusBar({
	gitStatus,
	hasUnsavedChanges,
	onBeforePull,
	onPullComplete,
	onBeforeCommit,
	onAfterCommit,
	onBeforeResolveDraft,
	onDraftResolved,
	onRenameUndone,
}: GitStatusBarProps): JSX.Element {
	const [showCommitDialog, setShowCommitDialog] = useState(false);
	const [showPullConfirm, setShowPullConfirm] = useState(false);
	const [showConflicts, setShowConflicts] = useState(false);
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
		await onBeforeCommit?.();
		let committed = false;
		try {
			committed = (await gitStatus.commit(message)) !== null;
		} finally {
			await onAfterCommit?.(committed);
		}

		// Refused over drafts someone else's commit has changed under: those get resolved
		// first, in their own dialog; the message is kept for the commit after.
		if (gitStatus.commitError?.draftConflicts) {
			gitStatus.clearErrors();
			setShowCommitDialog(false);
			setShowConflicts(true);
			return;
		}

		// Close dialog and clear stored message on success
		if (!gitStatus.commitError) {
			setShowCommitDialog(false);
			lastCommitMessageRef.current = '';
		}
	};

	const conflictCount = gitStatus.conflictedFiles.length;

	const handleRetry = (): void => {
		// Open dialog - it will use initialMessage prop to restore previous message
		setShowCommitDialog(true);
	};

	const handleDismiss = (): void => {
		gitStatus.clearErrors();
	};

	// After a refused commit or one that landed only partway, pulling is the way on.
	const handlePullFromNotice = (): void => {
		gitStatus.clearErrors();
		handlePullClick();
	};

	return (
		<div class={styles.container}>
			{/* Error banners */}
			{gitStatus.pullError && (
				<Notice variant="error" class={styles.notice}>
					<span class={styles.noticeText}>{gitStatus.pullError}</span>
					<Button onClick={handleDismiss} class="icon" aria-label="Dismiss error">
						<Icon name="x" class="size-sm" />
					</Button>
				</Notice>
			)}
			{gitStatus.commitError && (
				<CommitErrorBanner
					error={gitStatus.commitError}
					onRetry={handleRetry}
					onPull={handlePullFromNotice}
					onDismiss={handleDismiss}
				/>
			)}
			{conflictCount > 0 && !showConflicts && (
				<Notice variant="warning" announce class={styles.notice}>
					<span class={styles.noticeText}>
						{conflictCount === 1
							? 'Someone changed a file you\'re editing since you started.'
							: `Someone changed ${conflictCount} files you're editing since you started.`}
					</span>
					<Button onClick={() => setShowConflicts(true)} class="secondary size-sm">
						Review
					</Button>
				</Notice>
			)}
			{gitStatus.commitWarning && (
				<Notice variant="warning" announce class={styles.notice}>
					<span class={styles.noticeText}>{gitStatus.commitWarning}</span>
					<Button onClick={handlePullFromNotice} class="secondary size-sm">
						Pull
					</Button>
					<Button onClick={handleDismiss} class="icon" aria-label="Dismiss">
						<Icon name="x" class="size-sm" />
					</Button>
				</Notice>
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

			<DraftConflictsDialog
				open={showConflicts}
				gitStatus={gitStatus}
				onClose={() => setShowConflicts(false)}
				onBeforeResolve={onBeforeResolveDraft}
				onResolved={onDraftResolved}
				onRenameUndone={onRenameUndone}
			/>

			{/* Pull confirmation when there are unsaved changes */}
			<ConfirmDialog
				open={showPullConfirm}
				title="Unsaved changes"
				message="You have unsaved changes in the editor. Pulling will save your changes first, then update with the latest from remote."
				warning="If someone else changed a file you're editing, you'll choose whether to keep your version or theirs before you commit."
				confirmText="Save & Pull"
				confirmVariant="primary"
				cancelText="Cancel"
				onConfirm={handlePullConfirm}
				onCancel={() => setShowPullConfirm(false)}
			/>
		</div>
	);
}
