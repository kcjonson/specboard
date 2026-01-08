import { useMemo, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate, type RouteProps } from '@doc-platform/router';
import { Page, Icon } from '@doc-platform/ui';
import {
	DocumentModel,
	UserModel,
	useModel,
	saveToLocalStorage,
	loadFromLocalStorage,
	hasPersistedContent,
	clearLocalStorage,
	type DocumentComment,
} from '@doc-platform/models';
import { fetchClient } from '@doc-platform/fetch';
import { captureError } from '@doc-platform/telemetry';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { MarkdownEditor, fromMarkdown, toMarkdown } from '../MarkdownEditor';
import { ChatSidebar } from '../ChatSidebar';
import { EditorHeader } from './EditorHeader';
import { RecoveryDialog } from './RecoveryDialog';
import styles from './Editor.module.css';

interface LoadError {
	message: string;
	filePath: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selected file persistence
// ─────────────────────────────────────────────────────────────────────────────

const SELECTED_FILE_KEY = 'editor.selectedFile';

function loadSelectedFile(projectId: string): string | null {
	try {
		const stored = globalThis.localStorage?.getItem(SELECTED_FILE_KEY);
		if (stored) {
			const all = JSON.parse(stored) as Record<string, string>;
			return all[projectId] || null;
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

function saveSelectedFile(projectId: string, filePath: string | null): void {
	try {
		const storage = globalThis.localStorage;
		if (!storage) return;
		const stored = storage.getItem(SELECTED_FILE_KEY);
		const all = stored ? (JSON.parse(stored) as Record<string, string>) : {};
		if (filePath) {
			all[projectId] = filePath;
		} else {
			delete all[projectId];
		}
		storage.setItem(SELECTED_FILE_KEY, JSON.stringify(all));
	} catch {
		// Ignore storage errors
	}
}

/**
 * Migrate cached localStorage content from one file path to another.
 * Used when renaming files to preserve unsaved edits.
 */
function migrateLocalStorageContent(projectId: string, oldPath: string, newPath: string): void {
	if (hasPersistedContent(projectId, oldPath)) {
		const cached = loadFromLocalStorage(projectId, oldPath);
		if (cached) {
			saveToLocalStorage(projectId, newPath, cached);
		}
		clearLocalStorage(projectId, oldPath);
	}
}

export function Editor(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Document model - source of truth for editor content
	const documentModel = useMemo(() => new DocumentModel(), []);

	// Current user model - for comment author info
	// SyncModel auto-fetches from /api/users/me when given id='me'.
	// If not authenticated, fetch fails and we fall back to "Anonymous" in getCommentAuthor.
	const currentUser = useMemo(() => new UserModel({ id: 'me' }), []);

	// Subscribe to model changes - this re-renders when user data loads
	useModel(documentModel);
	useModel(currentUser);

	// Track previous content for debounced localStorage save
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Track if we've attempted to restore the selected file
	const restoredRef = useRef(false);

	// Error state for file loading failures
	const [loadError, setLoadError] = useState<LoadError | null>(null);

	// Pending recovery dialog state (file path with cached changes)
	const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);

	// Reference to the startNewFile function from FileBrowser
	const startNewFileRef = useRef<((parentPath?: string) => void) | null>(null);

	// Track pending new file state to show creating notice
	const [isCreatingFile, setIsCreatingFile] = useState(false);

	// Reference to the renameFile function from FileBrowser
	const renameFileRef = useRef<((path: string, newFilename: string) => Promise<string>) | null>(null);

	// Epic linking state
	const [linkedEpicId, setLinkedEpicId] = useState<string | undefined>();
	const [creatingEpic, setCreatingEpic] = useState(false);
	const creatingEpicRef = useRef(false);

	// Chat sidebar state
	const [showChat, setShowChat] = useState(false);

	// Check if file has a linked epic
	const checkLinkedEpic = useCallback(async (path: string) => {
		// Only check for markdown files
		if (!path.endsWith('.md') && !path.endsWith('.markdown')) {
			setLinkedEpicId(undefined);
			return;
		}

		try {
			const epics = await fetchClient.get<Array<{ id: string }>>(
				`/api/projects/${projectId}/epics?specDocPath=${encodeURIComponent(path)}`
			);
			setLinkedEpicId(epics.length > 0 ? epics[0]?.id : undefined);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'epic_link_check_error',
				filePath: path,
				projectId,
			});
			// Fail gracefully - epic linking is optional
			setLinkedEpicId(undefined);
		}
	}, [projectId]);

	// Load file from server
	const loadFileFromServer = useCallback(async (path: string) => {
		try {
			const response = await fetchClient.get<{ content: string }>(
				`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`
			);
			const { content: slateContent, comments } = fromMarkdown(response.content);
			documentModel.loadDocument(projectId, path, slateContent, { comments });
			saveSelectedFile(projectId, path);
			// Check if this document has a linked epic
			checkLinkedEpic(path);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'file_load_error',
				filePath: path,
				projectId,
			});
			setLoadError({
				message: 'Unable to load this file. The file may be corrupted or contain unsupported formatting.',
				filePath: path,
			});
		}
	}, [projectId, documentModel, checkLinkedEpic]);

	// Handle file selection from FileBrowser
	const handleFileSelect = useCallback(async (path: string) => {
		setLoadError(null);

		// Check for cached changes - show recovery dialog if found
		if (hasPersistedContent(projectId, path)) {
			setPendingRecovery(path);
			return;
		}

		await loadFileFromServer(path);
	}, [projectId, loadFileFromServer]);

	// Handle file renamed via sidebar double-click
	const handleFileRenamed = useCallback((oldPath: string, newPath: string) => {
		// If the renamed file is the currently open file, update the model
		if (documentModel.filePath === oldPath) {
			migrateLocalStorageContent(projectId, oldPath, newPath);
			saveSelectedFile(projectId, newPath);
			documentModel.updateFilePath(newPath);
		}
	}, [projectId, documentModel]);

	// Handle restore from recovery dialog
	const handleRestore = useCallback(() => {
		if (!pendingRecovery) return;

		const cached = loadFromLocalStorage(projectId, pendingRecovery);
		if (cached) {
			documentModel.loadDocument(projectId, pendingRecovery, cached.content, {
				dirty: true,
				comments: cached.comments,
			});
			saveSelectedFile(projectId, pendingRecovery);
			// Check if this document has a linked epic
			checkLinkedEpic(pendingRecovery);
		}
		setPendingRecovery(null);
	}, [projectId, pendingRecovery, documentModel, checkLinkedEpic]);

	// Handle discard from recovery dialog
	const handleDiscard = useCallback(async () => {
		if (!pendingRecovery) return;

		clearLocalStorage(projectId, pendingRecovery);
		await loadFileFromServer(pendingRecovery);
		setPendingRecovery(null);
	}, [projectId, pendingRecovery, loadFileFromServer]);

	// Create epic from current document
	const handleCreateEpic = useCallback(async () => {
		const filePath = documentModel.filePath;
		// Use ref to prevent race condition from rapid clicks
		if (!filePath || creatingEpicRef.current) return;

		// Extract title from filename (without extension)
		const fileName = filePath.split('/').pop() || 'Untitled';
		let title = fileName.replace(/\.(md|markdown)$/, '');
		if (!title.trim()) {
			title = 'Untitled';
		}

		creatingEpicRef.current = true;
		setCreatingEpic(true);
		try {
			const response = await fetchClient.post<{ id: string }>(
				`/api/projects/${projectId}/epics`,
				{
					title,
					specDocPath: filePath,
					status: 'ready',
				}
			);
			setLinkedEpicId(response.id);
			// Navigate to Planning page with highlight param
			navigate(`/projects/${projectId}/planning?highlight=${response.id}`);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'epic_create_error',
				filePath,
				projectId,
			});
			// Show user feedback
			globalThis.alert?.('Failed to create epic. Please try again.');
		} finally {
			creatingEpicRef.current = false;
			setCreatingEpic(false);
		}
	}, [projectId, documentModel.filePath]);

	// Navigate to view the linked epic
	const handleViewEpic = useCallback(() => {
		if (linkedEpicId) {
			navigate(`/projects/${projectId}/planning?highlight=${linkedEpicId}`);
		}
	}, [projectId, linkedEpicId]);

	// ─────────────────────────────────────────────────────────────────────────────
	// Comment handlers
	// ─────────────────────────────────────────────────────────────────────────────

	// Get current user info for comments
	const getCommentAuthor = useCallback((): { name: string; email: string } => {
		if (currentUser.first_name && currentUser.last_name) {
			return {
				name: `${currentUser.first_name} ${currentUser.last_name}`,
				email: currentUser.email || '',
			};
		}
		if (currentUser.username) {
			return {
				name: currentUser.username,
				email: currentUser.email || '',
			};
		}
		return {
			name: 'Anonymous',
			email: '',
		};
	}, [currentUser.first_name, currentUser.last_name, currentUser.username, currentUser.email]);

	// Handle adding a new comment
	const handleAddComment = useCallback((commentId: string, commentText: string, _anchorText: string) => {
		const author = getCommentAuthor();
		const newComment: DocumentComment = {
			id: commentId, // Use the ID from MarkdownEditor that was applied to the text
			text: commentText,
			author: author.name,
			authorEmail: author.email,
			timestamp: new Date().toISOString(),
			resolved: false,
			replies: [],
		};
		documentModel.addComment(newComment);
	}, [documentModel, getCommentAuthor]);

	// Handle adding a reply to a comment
	const handleReplyToComment = useCallback((commentId: string, replyText: string) => {
		const author = getCommentAuthor();
		const reply: DocumentComment = {
			id: `reply-${Date.now()}-${crypto.randomUUID()}`,
			text: replyText,
			author: author.name,
			authorEmail: author.email,
			timestamp: new Date().toISOString(),
			resolved: false,
			replies: [],
		};
		documentModel.addReply(commentId, reply);
	}, [documentModel, getCommentAuthor]);

	// Handle toggling a comment's resolved status
	const handleToggleResolved = useCallback((commentId: string) => {
		documentModel.toggleResolved(commentId);
	}, [documentModel]);

	// Restore previously selected file on mount
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;

		const savedPath = loadSelectedFile(projectId);
		if (savedPath) {
			handleFileSelect(savedPath);
		}
	}, [projectId, handleFileSelect]);

	// Handle save
	const handleSave = useCallback(async () => {
		if (!documentModel.filePath || !documentModel.projectId) return;
		if (documentModel.saving) return;

		const { projectId: pid, filePath: fpath } = documentModel;
		documentModel.saving = true;
		try {
			// Include comments in the markdown output
			const markdown = toMarkdown(documentModel.content, documentModel.comments);
			await fetchClient.put(
				`/api/projects/${pid}/files?path=${encodeURIComponent(fpath)}`,
				{ content: markdown }
			);
			documentModel.markSaved();
			try {
				clearLocalStorage(pid, fpath);
			} catch (storageErr) {
				console.warn('Failed to clear local draft from localStorage:', storageErr);
			}
		} catch (err) {
			console.error('Failed to save file:', err);
			// Could show error UI here
		} finally {
			documentModel.saving = false;
		}
	}, [documentModel]);

	// Debounced localStorage persistence on content change
	useEffect(() => {
		const { filePath, projectId: pid, content, comments } = documentModel;
		if (!filePath || !pid) return;
		if (!documentModel.isDirty) return;

		// Clear previous timer
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
		}

		// Save to localStorage after 1 second of inactivity
		// Capture values before setTimeout to avoid stale references
		saveTimerRef.current = setTimeout(() => {
			saveToLocalStorage(pid, filePath, content, comments);
		}, 1000);

		return () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
		};
	}, [documentModel.content, documentModel.comments, documentModel.filePath, documentModel.projectId, documentModel.isDirty]);

	// Keyboard shortcut for save (Ctrl/Cmd+S)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent): void => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault();
				handleSave();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleSave]);

	// Handle receiving the startNewFile function from FileBrowser
	const handleStartNewFileRef = useCallback((startNewFile: (parentPath: string) => void) => {
		startNewFileRef.current = startNewFile;
	}, []);

	// Handle "New Page" button click from EditorHeader
	const handleNewPage = useCallback(() => {
		if (!startNewFileRef.current) return;

		// Determine target directory:
		// - If a file is open, use its directory
		// - Otherwise, FileBrowser will use first rootPath
		let targetDir: string | undefined;

		if (documentModel.filePath) {
			// Extract directory from current file path
			const lastSlash = documentModel.filePath.lastIndexOf('/');
			if (lastSlash > 0) {
				targetDir = documentModel.filePath.substring(0, lastSlash);
			}
		}

		startNewFileRef.current(targetDir);
		setIsCreatingFile(true);
	}, [documentModel.filePath]);

	// Handle file created callback from FileBrowser
	const handleFileCreated = useCallback(async (path: string) => {
		setIsCreatingFile(false);
		// Select the newly created file
		await handleFileSelect(path);
	}, [handleFileSelect]);

	// Handle file creation cancelled
	const handleCancelNewFile = useCallback(() => {
		setIsCreatingFile(false);
	}, []);

	// Handle receiving the renameFile function from FileBrowser
	const handleRenameFileRef = useCallback((renameFile: (path: string, newFilename: string) => Promise<string>) => {
		renameFileRef.current = renameFile;
	}, []);

	// Handle rename from EditorHeader
	const handleRename = useCallback(async (newFilename: string) => {
		if (!documentModel.filePath || !renameFileRef.current) return;

		const oldPath = documentModel.filePath;
		try {
			const newPath = await renameFileRef.current(oldPath, newFilename);

			migrateLocalStorageContent(projectId, oldPath, newPath);
			saveSelectedFile(projectId, newPath);
			documentModel.updateFilePath(newPath);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'file_rename_error',
				filePath: oldPath,
				newFilename,
				projectId,
			});
			// Show user-friendly error - using alert for simplicity
			// (File operations typically succeed, so a dedicated UI component isn't warranted)
			alert(`Failed to rename file: ${error.message}`);
		}
	}, [projectId, documentModel]);

	return (
		<Page projectId={projectId} activeTab="Pages">
			<div class={styles.body}>
				<FileBrowser
					projectId={projectId}
					selectedPath={documentModel.filePath || undefined}
					onFileSelect={handleFileSelect}
					onFileCreated={handleFileCreated}
					onCancelNewFile={handleCancelNewFile}
					onFileRenamed={handleFileRenamed}
					onStartNewFileRef={handleStartNewFileRef}
					onRenameFileRef={handleRenameFileRef}
					class={styles.sidebar}
				/>
				<main class={styles.main}>
					{loadError ? (
						<div class={styles.errorState}>
							<div class={styles.errorStateContent}>
								<div class={styles.errorStateIcon}>!</div>
								<div class={styles.errorStateTitle}>Unable to load file</div>
								<div class={styles.errorStateMessage}>{loadError.message}</div>
								<div class={styles.errorStateFile}>{loadError.filePath}</div>
								<div class={styles.errorStateActions}>
									<button
										class={styles.errorRetryButton}
										onClick={() => handleFileSelect(loadError.filePath)}
									>
										Try Again
									</button>
									<button
										class={styles.errorDismissButton}
										onClick={() => setLoadError(null)}
									>
										Dismiss
									</button>
								</div>
							</div>
						</div>
					) : isCreatingFile ? (
						<div class={styles.creatingState}>
							<div class={styles.creatingStateContent}>
								<div class={styles.creatingStateIcon}><Icon name="pencil" class="size-2xl" /></div>
								<div class={styles.creatingStateTitle}>Creating new file</div>
								<div class={styles.creatingStateHint}>
									Enter a filename in the sidebar to continue
								</div>
							</div>
						</div>
					) : documentModel.filePath ? (
						<>
							<EditorHeader
								title={documentModel.title}
								filePath={documentModel.filePath}
								isDirty={documentModel.isDirty}
								saving={documentModel.saving}
								onSave={handleSave}
								onNewPage={handleNewPage}
								onRename={handleRename}
								linkedEpicId={linkedEpicId}
								creatingEpic={creatingEpic}
								onCreateEpic={handleCreateEpic}
								onViewEpic={handleViewEpic}
								showChat={showChat}
								onToggleChat={() => setShowChat(!showChat)}
							/>
							<div class={styles.mainContent}>
								<div class={styles.editorArea}>
									<MarkdownEditor
										model={documentModel}
										comments={documentModel.comments}
										placeholder="Start writing..."
										onAddComment={handleAddComment}
										onReply={handleReplyToComment}
										onToggleResolved={handleToggleResolved}
									/>
								</div>
								{showChat && (
									<ChatSidebar
										documentContent={toMarkdown(documentModel.content, documentModel.comments)}
										documentPath={documentModel.filePath}
										onClose={() => setShowChat(false)}
									/>
								)}
							</div>
						</>
					) : (
						<div class={styles.emptyState}>
							<div class={styles.emptyStateContent}>
								<div class={styles.emptyStateIcon}><Icon name="file" class="size-2xl" /></div>
								<div class={styles.emptyStateTitle}>No file selected</div>
								<div class={styles.emptyStateHint}>
									Select a markdown file from the sidebar to start editing
								</div>
							</div>
						</div>
					)}
				</main>
			</div>
			{pendingRecovery && (
				<RecoveryDialog
					filePath={pendingRecovery}
					onRestore={handleRestore}
					onDiscard={handleDiscard}
				/>
			)}
		</Page>
	);
}
