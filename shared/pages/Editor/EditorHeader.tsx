import type { JSX } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { Button } from '@doc-platform/ui';
import styles from './EditorHeader.module.css';

export interface EditorHeaderProps {
	/** Document title (usually filename) */
	title: string;
	/** File path being edited (null if no file loaded) */
	filePath: string | null;
	/** Whether the document has unsaved changes */
	isDirty: boolean;
	/** Whether a save operation is in progress */
	saving: boolean;
	/** Callback to save the document */
	onSave: () => void;
	/** Callback to create a new page */
	onNewPage?: () => void;
	/** Callback to rename the current file */
	onRename?: (newFilename: string) => void;
	/** ID of linked epic (if this document has one) */
	linkedEpicId?: string;
	/** Whether epic creation is in progress */
	creatingEpic?: boolean;
	/** Callback to create an epic from this document */
	onCreateEpic?: () => void;
	/** Callback to view the linked epic */
	onViewEpic?: () => void;
	/** Whether the chat sidebar is visible */
	showChat?: boolean;
	/** Callback to toggle the chat sidebar */
	onToggleChat?: () => void;
}

/** Check if file path is a markdown file */
function isMarkdownFile(filePath: string | null): boolean {
	if (!filePath) return false;
	return filePath.endsWith('.md') || filePath.endsWith('.markdown');
}

export function EditorHeader({
	title,
	filePath,
	isDirty,
	saving,
	onSave,
	onNewPage,
	onRename,
	linkedEpicId,
	creatingEpic,
	onCreateEpic,
	onViewEpic,
	showChat,
	onToggleChat,
}: EditorHeaderProps): JSX.Element {
	const [isEditing, setIsEditing] = useState(false);
	const [editTitle, setEditTitle] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);
	const showEpicButton = isMarkdownFile(filePath);

	// Focus and select input when editing starts
	// Intentionally only depends on isEditing - we capture the initial title for selection
	// but don't want to refocus/reselect on every keystroke
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			// Select filename without extension
			const dotIndex = title.lastIndexOf('.');
			if (dotIndex > 0) {
				inputRef.current.setSelectionRange(0, dotIndex);
			} else {
				inputRef.current.select();
			}
		}
	}, [isEditing]);

	const handleStartEditing = (): void => {
		if (!filePath || !onRename) return;
		setEditTitle(title);
		setIsEditing(true);
	};

	const handleSubmit = (): void => {
		const trimmed = editTitle.trim();
		if (trimmed && trimmed !== title && onRename) {
			onRename(trimmed);
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			setIsEditing(false);
		}
	};

	const handleBlur = (): void => {
		// Delay to allow click events to fire first (200ms handles slower devices)
		setTimeout(() => {
			if (isEditing) {
				handleSubmit();
			}
		}, 200);
	};

	return (
		<div class={styles.header}>
			<div class={styles.titleArea}>
				{isEditing ? (
					<input
						ref={inputRef}
						type="text"
						class={styles.titleInput}
						value={editTitle}
						onInput={(e) => setEditTitle((e.target as HTMLInputElement).value)}
						onKeyDown={handleKeyDown}
						onBlur={handleBlur}
						aria-label="Rename file"
					/>
				) : (
					<>
						<span class={styles.title}>{title}</span>
						{filePath && onRename && (
							<button
								class={styles.editButton}
								onClick={handleStartEditing}
								title="Rename file"
								aria-label="Rename file"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
								</svg>
							</button>
						)}
					</>
				)}
				{isDirty && !isEditing && <span class={styles.dirtyIndicator} title="Unsaved changes">*</span>}
			</div>
			<div class={styles.actions}>
				{onToggleChat && (
					<Button
						onClick={onToggleChat}
						variant={showChat ? 'primary' : 'secondary'}
						title={showChat ? 'Close AI Chat' : 'Open AI Chat'}
						aria-expanded={showChat}
						aria-controls="ai-chat-sidebar"
					>
						Ask AI
					</Button>
				)}
				{onNewPage && (
					<Button
						onClick={onNewPage}
						variant="secondary"
					>
						New Page
					</Button>
				)}
				{showEpicButton && linkedEpicId && onViewEpic && (
					<Button onClick={onViewEpic} variant="secondary">
						View Epic
					</Button>
				)}
				{showEpicButton && !linkedEpicId && onCreateEpic && (
					<Button
						onClick={onCreateEpic}
						variant="secondary"
						disabled={creatingEpic}
					>
						{creatingEpic ? 'Creating...' : 'Create Epic'}
					</Button>
				)}
				{filePath && (
					<Button
						onClick={onSave}
						disabled={!isDirty || saving}
						variant={isDirty ? 'primary' : 'secondary'}
					>
						{saving ? 'Saving...' : 'Save'}
					</Button>
				)}
			</div>
		</div>
	);
}
