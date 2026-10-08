import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Dialog, DialogFooter, Icon } from '@specboard/ui';
import type { IconName } from '@specboard/ui';
import type { GitStatusModel, ChangedFile } from '@specboard/models';
import styles from './CommitDialog.module.css';

export interface CommitDialogProps {
	open: boolean;
	gitStatus: GitStatusModel;
	onClose: () => void;
	onCommit: (message?: string) => Promise<void>;
	/** Initial message to pre-fill (e.g., for retry after failure) */
	initialMessage?: string;
}

function getStatusIcon(status: ChangedFile['status']): IconName {
	switch (status) {
		case 'added':
			return 'plus';
		case 'modified':
			return 'pencil';
		case 'deleted':
			return 'trash-2';
		case 'renamed':
			return 'file';
		default:
			return 'file';
	}
}

function getStatusLabel(status: ChangedFile['status']): string {
	switch (status) {
		case 'added':
			return 'Added';
		case 'modified':
			return 'Modified';
		case 'deleted':
			return 'Deleted';
		case 'renamed':
			return 'Renamed';
		default:
			return status;
	}
}

export function CommitDialog({
	open,
	gitStatus,
	onClose,
	onCommit,
	initialMessage = '',
}: CommitDialogProps): JSX.Element | null {
	const [commitMessage, setCommitMessage] = useState('');
	// One commit request at a time: ⌘+Enter and a click can both land before the commit
	// itself marks the model busy (saving the open file comes first).
	const submittingRef = useRef(false);
	const [submitting, setSubmitting] = useState(false);

	// Reset commit message when dialog opens (use initialMessage for retries)
	useEffect(() => {
		if (open) {
			setCommitMessage(initialMessage);
		}
	}, [open, initialMessage]);

	if (!open) return null;

	const submit = async (): Promise<void> => {
		if (submittingRef.current || gitStatus.committing) return;
		submittingRef.current = true;
		setSubmitting(true);
		try {
			await onCommit(commitMessage.trim() || undefined);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	const handleSubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		await submit();
	};

	const handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
		// Submit on Cmd/Ctrl + Enter
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			await submit();
		}
	};

	const changedFiles = gitStatus.changedFiles;

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="Commit Changes"
			maxWidth="md"
		>
			<form class={styles.form} onSubmit={handleSubmit}>
				<div class={styles.fileList}>
					<div class={styles.fileListHeader}>
						<span class={styles.fileCount}>
							{changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed
						</span>
					</div>
					<div class={styles.files}>
						{changedFiles.map((file) => (
							<div key={file.path} class={styles.file}>
								<Icon
									name={getStatusIcon(file.status)}
									class={`size-sm ${styles[file.status]}`}
								/>
								<span class={styles.filePath}>{file.path}</span>
								<span class={`${styles.statusBadge} ${styles[file.status]}`}>
									{getStatusLabel(file.status)}
								</span>
							</div>
						))}
					</div>
				</div>

				<div class={styles.field}>
					<label class={styles.label} htmlFor="commit-message">
						<span class={styles.labelText}>Commit message (optional)</span>
					</label>
					<textarea
						id="commit-message"
						class={styles.textarea}
						value={commitMessage}
						onInput={(e) => setCommitMessage((e.target as HTMLTextAreaElement).value)}
						onKeyDown={handleKeyDown}
						placeholder="Describe your changes..."
						rows={3}
						autoFocus
					/>
					<span class={styles.hint}>
						Press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to commit
					</span>
				</div>

				<DialogFooter>
					<Button onClick={onClose} class="secondary" type="button">
						Cancel
					</Button>
					<Button
						type="submit"
						class="primary"
						busy={submitting || gitStatus.committing}
					>
						{submitting || gitStatus.committing ? 'Committing...' : 'Commit'}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
