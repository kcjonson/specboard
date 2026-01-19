import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Dialog, Icon } from '@doc-platform/ui';
import type { IconName } from '@doc-platform/ui';
import type { GitStatusModel, ChangedFile } from '@doc-platform/models';
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

	// Reset commit message when dialog opens (use initialMessage for retries)
	useEffect(() => {
		if (open) {
			setCommitMessage(initialMessage);
		}
	}, [open, initialMessage]);

	if (!open) return null;

	const handleSubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		await onCommit(commitMessage.trim() || undefined);
	};

	const handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
		// Submit on Cmd/Ctrl + Enter
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			await onCommit(commitMessage.trim() || undefined);
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

				<div class={styles.actions}>
					<Button onClick={onClose} class="secondary" type="button">
						Cancel
					</Button>
					<Button
						type="submit"
						class="primary"
						disabled={gitStatus.committing}
					>
						{gitStatus.committing ? 'Committing...' : 'Commit'}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
