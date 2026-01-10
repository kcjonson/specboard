import { useMemo, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate, type RouteProps } from '@doc-platform/router';
import { Page, Icon, ErrorBoundary } from '@doc-platform/ui';
import {
	DocumentModel,
	UserModel,
	GitStatusModel,
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
import { MarkdownEditor, fromMarkdown, toMarkdown, type MarkdownEditorHandle } from '../MarkdownEditor';
import { ChatSidebar } from '../ChatSidebar';
import { EditorHeader } from './EditorHeader';
import { RecoveryDialog } from './RecoveryDialog';
import { SaveErrorBanner } from './SaveErrorBanner';
import styles from './Editor.module.css';

// Auto-save configuration
const AUTO_SAVE_DEBOUNCE_MS = 2500; // 2.5 seconds debounce for server save
const SAVE_RETRY_DELAY_MS = 5000; // 5 seconds between retries
const MAX_SAVE_RETRIES = 3;

interface SaveError {
	hasLocalChanges: boolean;
	lastAttempt: Date;
	retryCount: number;
	message: string;
}

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

	// Git status model - tracks uncommitted changes
	const gitStatusModel = useMemo(() => new GitStatusModel(), []);

	// Current user model - for comment author info
	// SyncModel auto-fetches from /api/users/me when given id='me'.
	// If not authenticated, fetch fails and we fall back to "Anonymous" in getCommentAuthor.
	const currentUser = useMemo(() => new UserModel({ id: 'me' }), []);

	// Subscribe to model changes - this re-renders when user data loads
	useModel(documentModel);
	useModel(gitStatusModel);
	useModel(currentUser);

	// Auto-save state
	const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRetryCount = useRef(0);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<SaveError | null>(null);

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

	// Reference to MarkdownEditor for imperative operations (e.g., applying AI edits)
	const editorRef = useRef<MarkdownEditorHandle>(null);

	// Epic linking state
	const [linkedEpicId, setLinkedEpicId] = useState<string | undefined>();
	const [creatingEpic, setCreatingEpic] = useState(false);
	const creatingEpicRef = useRef(false);

	// Restore file state
	const [isRestoring, setIsRestoring] = useState(false);


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

	// Initialize git status when project changes
	useEffect(() => {
		gitStatusModel.projectId = projectId;
		gitStatusModel.refresh();
	}, [projectId, gitStatusModel]);

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
			// Clear the saved selection so we don't try to load a deleted/missing file on refresh
			saveSelectedFile(projectId, null);
			setLoadError({
				message: 'Unable to load this file. The file may have been deleted or moved.',
				filePath: path,
			});
		}
	}, [projectId, documentModel, checkLinkedEpic]);

	// ─────────────────────────────────────────────────────────────────────────────
	// Auto-save mechanism (defined before handleFileSelect which depends on it)
	// ─────────────────────────────────────────────────────────────────────────────

	// Perform server save
	const performServerSave = useCallback(async (): Promise<boolean> => {
		if (!documentModel.filePath || !documentModel.projectId) return true;
		if (!documentModel.isDirty) return true;

		const { projectId: pid, filePath: fpath, content, comments } = documentModel;

		setIsSaving(true);
		try {
			const markdown = toMarkdown(content, comments);
			await fetchClient.put(
				`/api/projects/${pid}/files?path=${encodeURIComponent(fpath)}`,
				{ content: markdown }
			);
			documentModel.markSaved();

			// Clear localStorage on successful server save
			try {
				clearLocalStorage(pid, fpath);
			} catch (storageErr) {
				console.warn('Failed to clear local draft from localStorage:', storageErr);
			}

			// Reset retry count and clear error on success
			saveRetryCount.current = 0;
			setSaveError(null);

			// Refresh git status after save
			gitStatusModel.refresh();

			return true;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to save';
			console.error('Server save failed:', errorMessage);

			// Ensure localStorage has latest changes as fallback
			saveToLocalStorage(pid, fpath, content, comments);

			// Update error state
			saveRetryCount.current++;
			setSaveError({
				hasLocalChanges: true,
				lastAttempt: new Date(),
				retryCount: saveRetryCount.current,
				message: errorMessage,
			});

			// Schedule retry if under max retries
			if (saveRetryCount.current < MAX_SAVE_RETRIES) {
				if (saveRetryTimerRef.current) {
					clearTimeout(saveRetryTimerRef.current);
				}
				saveRetryTimerRef.current = setTimeout(() => {
					performServerSave();
				}, SAVE_RETRY_DELAY_MS);
			}

			return false;
		} finally {
			setIsSaving(false);
		}
	}, [documentModel, gitStatusModel]);

	// Handle file selection from FileBrowser
	const handleFileSelect = useCallback(async (path: string) => {
		setLoadError(null);

		// Save current file before switching (if dirty)
		if (documentModel.isDirty && documentModel.filePath) {
			await performServerSave();
		}

		// Check for cached changes - show recovery dialog if found
		if (hasPersistedContent(projectId, path)) {
			setPendingRecovery(path);
			return;
		}

		await loadFileFromServer(path);
	}, [projectId, loadFileFromServer, documentModel, performServerSave]);

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

	// Handle restoring a deleted file
	const handleRestoreDeletedFile = useCallback(async () => {
		const filePath = documentModel.filePath;
		if (!filePath) return;

		setIsRestoring(true);
		try {
			const success = await gitStatusModel.restore(filePath);
			if (success) {
				// Reload the file after restore
				await loadFileFromServer(filePath);
			}
		} finally {
			setIsRestoring(false);
		}
	}, [documentModel.filePath, gitStatusModel, loadFileFromServer]);

	// Check if current file is deleted
	const isCurrentFileDeleted = documentModel.filePath
		? gitStatusModel.isDeleted(documentModel.filePath)
		: false;

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

	// Manual retry from error banner
	const handleRetryManual = useCallback(() => {
		saveRetryCount.current = 0;
		performServerSave();
	}, [performServerSave]);

	// Immediate localStorage save + debounced server save on content change
	useEffect(() => {
		const { filePath, projectId: pid, content, comments } = documentModel;
		if (!filePath || !pid) return;
		if (!documentModel.isDirty) return;

		// Immediate localStorage save (crash recovery)
		saveToLocalStorage(pid, filePath, content, comments);

		// Clear previous server save timer
		if (serverSaveTimerRef.current) {
			clearTimeout(serverSaveTimerRef.current);
		}

		// Debounced server save
		serverSaveTimerRef.current = setTimeout(() => {
			performServerSave();
		}, AUTO_SAVE_DEBOUNCE_MS);

		return () => {
			if (serverSaveTimerRef.current) {
				clearTimeout(serverSaveTimerRef.current);
			}
		};
	}, [documentModel.content, documentModel.comments, documentModel.filePath, documentModel.projectId, documentModel.isDirty, performServerSave]);

	// Cleanup retry timer on unmount
	useEffect(() => {
		return () => {
			if (saveRetryTimerRef.current) {
				clearTimeout(saveRetryTimerRef.current);
			}
		};
	}, []);

	// Handle receiving the startNewFile function from FileBrowser
	const handleStartNewFileRef = useCallback((startNewFile: (parentPath: string) => void) => {
		startNewFileRef.current = startNewFile;
	}, []);

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

	// Handle file deleted - clear selection if deleted file was open
	const handleFileDeleted = useCallback((deletedPath: string) => {
		if (documentModel.filePath === deletedPath) {
			documentModel.clear();
			saveSelectedFile(projectId, null);
			setLinkedEpicId(undefined);
		}
	}, [documentModel, projectId]);

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

	// Handle applying AI-suggested edits from ChatSidebar
	const handleApplyEdit = useCallback((newMarkdown: string) => {
		const { content: slateContent, comments } = fromMarkdown(newMarkdown);
		// Use Slate Transforms API via ref to properly update editor content
		// This maintains undo history and updates the DOM correctly
		if (editorRef.current) {
			editorRef.current.replaceContent(slateContent);
		}
		// Update comments in the model (these aren't in Slate)
		documentModel.set({ comments, dirty: true });
	}, [documentModel]);

	// Memoize document content for chat to avoid recomputing on every render
	const documentContentForChat = useMemo(
		() => toMarkdown(documentModel.content, documentModel.comments),
		[documentModel.content, documentModel.comments]
	);

	return (
		<Page projectId={projectId} activeTab="Pages">
			{saveError && (
				<SaveErrorBanner
					message={saveError.message}
					retryCount={saveError.retryCount}
					maxRetries={MAX_SAVE_RETRIES}
					onRetry={handleRetryManual}
				/>
			)}
			<div class={styles.body}>
				<FileBrowser
					projectId={projectId}
					selectedPath={documentModel.filePath || undefined}
					gitStatus={gitStatusModel}
					onFileSelect={handleFileSelect}
					onFileCreated={handleFileCreated}
					onCancelNewFile={handleCancelNewFile}
					onFileRenamed={handleFileRenamed}
					onFileDeleted={handleFileDeleted}
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
					) : isCurrentFileDeleted ? (
						<div class={styles.deletedState}>
							<div class={styles.deletedStateContent}>
								<div class={styles.deletedStateIcon}>
									<Icon name="trash-2" class="size-lg" />
								</div>
								<div class={styles.deletedStateTitle}>File deleted</div>
								<div class={styles.deletedStateMessage}>
									This file has been deleted but not yet committed.
									You can restore it to recover your work.
								</div>
								<div class={styles.deletedStateFile}>{documentModel.filePath}</div>
								<div class={styles.deletedStateActions}>
									<button
										class={styles.restoreButton}
										onClick={handleRestoreDeletedFile}
										disabled={isRestoring}
									>
										<Icon name="rotate-ccw" class="size-sm" />
										{isRestoring ? 'Restoring...' : 'Restore File'}
									</button>
								</div>
							</div>
						</div>
					) : documentModel.filePath ? (
						<>
							<EditorHeader
								title={documentModel.title}
								filePath={documentModel.filePath}
								isDirty={documentModel.isDirty}
								isSaving={isSaving}
								onRename={handleRename}
								linkedEpicId={linkedEpicId}
								creatingEpic={creatingEpic}
								onCreateEpic={handleCreateEpic}
								onViewEpic={handleViewEpic}
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
										editorRef={editorRef}
									/>
								</div>
								<ErrorBoundary>
									<ChatSidebar
										documentContent={documentContentForChat}
										documentPath={documentModel.filePath}
										onApplyEdit={handleApplyEdit}
									/>
								</ErrorBoundary>
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
