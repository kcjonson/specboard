import { useMemo, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import { navigate, type RouteProps } from '@specboard/router';
import { formatProjectRef } from '@specboard/core/identifiers';
import { Page, Icon, Button, DrawerHandle, ErrorBoundary, ResizablePanel } from '@specboard/ui';
import {
	DocumentModel,
	UserModel,
	GitStatusModel,
	useModel,
	useProject,
	useProjectRole,
	writeFailure,
	saveToLocalStorage,
	loadFromLocalStorage,
	hasPersistedContent,
	clearLocalStorage,
	type DocumentComment,
} from '@specboard/models';
import { fetchClient, FetchError, fetchErrorText } from '@specboard/fetch';
import { captureError } from '@specboard/telemetry';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { ItemPicker } from '../ItemPicker/ItemPicker';
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

// Sidebar sizing. The center editor keeps at least CENTER_MIN px, so each
// sidebar's max width is the container minus the other sidebar minus CENTER_MIN.
const FILE_BROWSER_DEFAULT_WIDTH = 240;
const FILE_BROWSER_MIN_WIDTH = 180;
const CHAT_DEFAULT_WIDTH = 360;
const CHAT_MIN_WIDTH = 280;
const CENTER_MIN_WIDTH = 360;

interface SaveError {
	hasLocalChanges: boolean;
	lastAttempt: Date;
	message: string;
	/** Another attempt is scheduled. */
	retrying: boolean;
	/** The server refused the write (403); retrying can't help, so none is offered. */
	refused: boolean;
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

/** The server's refusal of a file a sync found binary or over its size limit. */
function isFileUnavailable(err: unknown): boolean {
	return err instanceof FetchError && err.status === 409 && (err.data as { code?: string } | undefined)?.code === 'FILE_UNAVAILABLE';
}

/**
 * Migrate cached localStorage content from one file path to another.
 * Used when renaming files to preserve unsaved edits.
 */
function migrateLocalStorageContent(projectId: string, oldPath: string, newPath: string): void {
	if (hasPersistedContent(projectId, oldPath)) {
		const cached = loadFromLocalStorage(projectId, oldPath);
		if (cached) {
			saveToLocalStorage(projectId, newPath, cached.content, cached.comments, cached.baseContentHash);
		}
		clearLocalStorage(projectId, oldPath);
	}
}

export function Editor(props: RouteProps): JSX.Element {
	const projectRef = formatProjectRef(props.params.owner!, props.params.project!);

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

	// The page's shared project (the header reads the same one) and the caller's role.
	// Without edit access the editor mounts read-only: no typing, comments, renames,
	// commits or pulls, and no draft recovery, which would only queue a refused save.
	const project = useProject(projectRef);
	const { canEdit, isOwner } = useProjectRole(projectRef);

	// Everything this editor persists locally — drafts, the last-opened file, the
	// tree's expansion state — is keyed by the project's immutable id rather than its
	// slug. Slugs are unique only per owner and are user-editable, so slug keys both
	// collided across accounts on a shared browser and were orphaned (or adopted by
	// another project) on rename. Nothing touches any of it until the id has loaded;
	// without the project the editor cannot load files either, so no draft goes
	// missing while it waits.
	const projectId: string | undefined = project.id;

	// A local project's files are on its owner's disk, so members get the board only
	// (docs/specs/multi-user-collaboration.md, What storage mode shares).
	const documentsElsewhere = project.storageMode === 'local' && !isOwner;

	// Auto-save state
	const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRetryCount = useRef(0);
	// Set while a commit runs: a save landing between the commit clearing this file's
	// draft and the editor taking its new base would be measured against the old one.
	const holdSavesRef = useRef(false);
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
	const renameFileRef = useRef<((path: string, newFilename: string, baseContentHash?: string | null) => Promise<string>) | null>(null);

	// Reference to MarkdownEditor for imperative operations (e.g., applying AI edits)
	const editorRef = useRef<MarkdownEditorHandle>(null);

	// Epic linking state
	const [linkedEpicKey, setLinkedEpicKey] = useState<string | undefined>();
	const [creatingEpic, setCreatingEpic] = useState(false);
	const [itemPickerOpen, setItemPickerOpen] = useState(false);
	const creatingEpicRef = useRef(false);

	// Restore file state
	const [isRestoring, setIsRestoring] = useState(false);

	// Small-screen panel takeovers. Inert on desktop: only the bp-small CSS in
	// Editor.module.css reads the resulting classes.
	const [filesOpen, setFilesOpen] = useState(false);
	const [chatOpen, setChatOpen] = useState(false);

	// One CloseWatcher per open takeover: Android back (and ESC) close the panel
	// instead of leaving the page. Every path that opens these is gated to small
	// screens (mobile-only buttons, the matchMedia check below), so the watchers
	// never mount on desktop, where they would eat the first ESC. The typeof
	// guard is the browser floor: latest-1 includes Safari 18.0–18.3, which
	// lack CloseWatcher (shipped 18.4) — there the drawer still closes via the
	// scrim and handle, it just loses back/ESC.
	useEffect(() => {
		if (!filesOpen || typeof CloseWatcher !== 'function') return;
		const watcher = new CloseWatcher();
		watcher.onclose = (): void => setFilesOpen(false);
		return () => watcher.destroy();
	}, [filesOpen]);

	useEffect(() => {
		if (!chatOpen || typeof CloseWatcher !== 'function') return;
		const watcher = new CloseWatcher();
		watcher.onclose = (): void => setChatOpen(false);
		return () => watcher.destroy();
	}, [chatOpen]);

	// With no file open (and none stored to restore) the drawer IS the landing
	// content. Fires on first visit and after a delete. Gated to small screens
	// (bp-small) because on desktop the panel is an in-flow column — opening it
	// there is invisible but mounts a CloseWatcher. Checking localStorage keeps
	// the drawer from flashing over a file that is about to restore.
	useEffect(() => {
		if (!projectId || documentModel.filePath || loadSelectedFile(projectId)) return;
		if (!globalThis.matchMedia('(width < 768px)').matches) return;
		setFilesOpen(true);
	}, [projectId, documentModel.filePath]);

	// A file opening (select, restore, create, rename) collapses the drawer.
	useEffect(() => {
		if (documentModel.filePath) setFilesOpen(false);
	}, [documentModel.filePath]);

	// Resizable sidebars. We measure the flex container (`.body`) and feed each
	// ResizablePanel a dynamic maxWidth so neither sidebar can crush the center
	// editor below CENTER_MIN_WIDTH. The panels own their width + persistence;
	// here we only track the live widths to compute the cross-panel limits.
	const bodyRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const [fileBrowserWidth, setFileBrowserWidth] = useState(FILE_BROWSER_DEFAULT_WIDTH);
	const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT_WIDTH);

	useEffect(() => {
		const el = bodyRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setContainerWidth(entry.contentRect.width);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);


	// Check if file has a linked epic
	const checkLinkedEpic = useCallback(async (path: string) => {
		// Only check for markdown files
		if (!path.endsWith('.md') && !path.endsWith('.markdown')) {
			setLinkedEpicKey(undefined);
			return;
		}

		try {
			const epics = await fetchClient.get<Array<{ key: string }>>(
				`/api/projects/${projectRef}/items?specPath=${encodeURIComponent(path)}`
			);
			setLinkedEpicKey(epics.length > 0 ? epics[0]?.key : undefined);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'epic_link_check_error',
				filePath: path,
				projectRef,
			});
			// Fail gracefully - epic linking is optional
			setLinkedEpicKey(undefined);
		}
	}, [projectRef]);

	// Initialize git status when project changes
	useEffect(() => {
		gitStatusModel.projectRef = projectRef;
		gitStatusModel.refresh();
	}, [projectRef, gitStatusModel]);

	// Load file from server
	const loadFileFromServer = useCallback(async (path: string) => {
		try {
			const response = await fetchClient.get<{ content: string; baseContentHash?: string | null }>(
				`/api/projects/${projectRef}/files?path=${encodeURIComponent(path)}`
			);
			const { content: slateContent, comments } = fromMarkdown(response.content);
			documentModel.loadDocument(projectId ?? '', path, slateContent, {
				comments,
				baseContentHash: response.baseContentHash,
			});
			if (projectId) saveSelectedFile(projectId, path);
			// Check if this document has a linked epic
			checkLinkedEpic(path);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'file_load_error',
				filePath: path,
				projectRef,
			});
			// Clear the saved selection so we don't try to load a deleted/missing file on refresh
			if (projectId) saveSelectedFile(projectId, null);
			setLoadError({
				// A file the sync found binary or too large says so in the server's words.
				message: isFileUnavailable(err)
					? fetchErrorText(err, 'This file can\'t be opened here.')
					: 'Unable to load this file. The file may have been deleted or moved.',
				filePath: path,
			});
		}
	}, [projectRef, projectId, documentModel, checkLinkedEpic]);

	// ─────────────────────────────────────────────────────────────────────────────
	// Auto-save mechanism (defined before handleFileSelect which depends on it)
	// ─────────────────────────────────────────────────────────────────────────────

	// Perform server save
	const performServerSave = useCallback(async (): Promise<boolean> => {
		if (!documentModel.filePath) return true;
		if (!documentModel.isDirty) return true;
		// The local copy keeps the edit; the commit's end saves it (handleAfterCommit).
		if (holdSavesRef.current) return false;

		// `pid` is the project's immutable id and keys localStorage ONLY. API paths are
		// addressed by owner/project ref — sending the UUID here 404s against those routes.
		const { projectId: pid, filePath: fpath, content, comments, baseContentHash } = documentModel;

		setIsSaving(true);
		try {
			const markdown = toMarkdown(content as Descendant[], comments);
			// The base tells a cloud draft what it was made against, so a commit can refuse
			// it if someone changed the file since it was opened.
			await fetchClient.put(
				`/api/projects/${projectRef}/files?path=${encodeURIComponent(fpath)}`,
				baseContentHash === undefined ? { content: markdown } : { content: markdown, baseContentHash }
			);
			documentModel.markSaved();

			// Clear localStorage on successful server save
			try {
				clearLocalStorage(pid ?? '', fpath);
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
			// A refusal (403) is the role having moved under the page: writeFailure re-reads
			// the project so the editor turns read-only, and retrying would only be refused
			// again. So is a file that became one the editor can't hold. Anything else may
			// be transient and is retried.
			const refused = (err instanceof FetchError && err.status === 403) || isFileUnavailable(err);
			const errorMessage = writeFailure(err, 'Failed to save', projectRef);
			console.error('Server save failed:', errorMessage);

			// Ensure localStorage has latest changes as fallback
			saveToLocalStorage(pid ?? '', fpath, content, comments, baseContentHash);

			// Update error state
			saveRetryCount.current++;
			const retrying = !refused && saveRetryCount.current < MAX_SAVE_RETRIES;
			setSaveError({
				hasLocalChanges: true,
				lastAttempt: new Date(),
				message: errorMessage,
				retrying,
				refused,
			});

			if (retrying) {
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
	}, [projectRef, documentModel, gitStatusModel]);

	// Handle file selection from FileBrowser
	const handleFileSelect = useCallback(async (path: string) => {
		setLoadError(null);

		// Tapping the already-open file just dismisses the drawer.
		if (path === documentModel.filePath) {
			setFilesOpen(false);
			return;
		}

		// Save current file before switching (if dirty)
		if (documentModel.isDirty && documentModel.filePath) {
			await performServerSave();
		}

		// Check for cached changes - show recovery dialog if found. Not for someone who
		// can't save them; the draft stays put for when they can.
		if (canEdit && projectId && hasPersistedContent(projectId, path)) {
			setPendingRecovery(path);
			return;
		}

		await loadFileFromServer(path);
	}, [canEdit, projectId, loadFileFromServer, documentModel, performServerSave]);

	// Take the open file's base from the server without touching what's on screen, after
	// a commit took its draft (the base is then the version just committed). Never
	// otherwise: the server's base for a file with no draft is what's committed now, which
	// may be newer than what's on screen.
	const refreshOpenDocumentBase = useCallback(async () => {
		const path = documentModel.filePath;
		if (!path) return;
		try {
			const response = await fetchClient.get<{ baseContentHash?: string | null }>(
				`/api/projects/${projectRef}/files?path=${encodeURIComponent(path)}`
			);
			if (documentModel.filePath === path) documentModel.baseContentHash = response.baseContentHash;
		} catch (err) {
			captureError(err instanceof Error ? err : new Error(String(err)), { type: 'file_base_refresh_error', filePath: path, projectRef });
		}
	}, [documentModel, projectRef]);

	// Handle file renamed via sidebar double-click
	// If the renamed file is the open one, show it from its new path: what the server holds
	// there (saved before the rename) and its base.
	const handleFileRenamed = useCallback(async (oldPath: string, newPath: string) => {
		if (documentModel.filePath === oldPath) {
			if (projectId) migrateLocalStorageContent(projectId, oldPath, newPath);
			await loadFileFromServer(newPath);
		}
	}, [projectId, documentModel, loadFileFromServer]);

	// Handle restore from recovery dialog
	const handleRestore = useCallback(() => {
		if (!pendingRecovery) return;

		const cached = projectId ? loadFromLocalStorage(projectId, pendingRecovery) : null;
		if (cached) {
			documentModel.loadDocument(projectId ?? '', pendingRecovery, cached.content, {
				dirty: true,
				comments: cached.comments,
				baseContentHash: cached.baseContentHash,
			});
			if (projectId) saveSelectedFile(projectId, pendingRecovery);
			// Check if this document has a linked epic
			checkLinkedEpic(pendingRecovery);
		}
		setPendingRecovery(null);
	}, [projectId, pendingRecovery, documentModel, checkLinkedEpic]);

	// Handle discard from recovery dialog
	const handleDiscard = useCallback(async () => {
		if (!pendingRecovery) return;

		if (projectId) clearLocalStorage(projectId, pendingRecovery);
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
			const response = await fetchClient.post<{ key: string }>(
				`/api/projects/${projectRef}/items`,
				{
					title,
					status: 'ready',
				}
			);
			// Link the current document as a product spec.
			await fetchClient.post(
				`/api/projects/${projectRef}/items/${response.key}/specs`,
				{ path: filePath, type: 'product' }
			);
			setLinkedEpicKey(response.key);
			// Navigate to Planning page with highlight param
			navigate(`/projects/${projectRef}/planning?highlight=${response.key}`);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'epic_create_error',
				filePath,
				projectRef,
			});
			// Show user feedback
			globalThis.alert?.('Failed to create epic. Please try again.');
		} finally {
			creatingEpicRef.current = false;
			setCreatingEpic(false);
		}
	}, [projectRef, documentModel.filePath]);

	// Open the linked epic on the board, with its detail drawer showing.
	const handleViewEpic = useCallback(() => {
		if (linkedEpicKey) {
			navigate(`/projects/${projectRef}/planning/items/${linkedEpicKey}`);
		}
	}, [projectRef, linkedEpicKey]);

	// Link the current document to an existing epic (as a product spec)
	const handleLinkEpic = useCallback(async (epicKey: string) => {
		const filePath = documentModel.filePath;
		setItemPickerOpen(false);
		if (!filePath) return;
		try {
			await fetchClient.post(
				`/api/projects/${projectRef}/items/${epicKey}/specs`,
				{ path: filePath, type: 'product' }
			);
		} catch (err) {
			// A 409 means it's already linked — treat as success. Log others.
			if (!(err instanceof FetchError && err.status === 409)) {
				const error = err instanceof Error ? err : new Error(String(err));
				captureError(error, { type: 'epic_link_error', filePath, projectRef });
			}
		}
		setLinkedEpicKey(epicKey);
	}, [projectRef, documentModel.filePath]);

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

	// Restore the previously selected file, once the project id is known.
	useEffect(() => {
		if (!projectId || restoredRef.current || documentsElsewhere) return;
		restoredRef.current = true;

		const savedPath = loadSelectedFile(projectId);
		if (savedPath) {
			handleFileSelect(savedPath);
		}
	}, [projectId, documentsElsewhere, handleFileSelect]);

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
		saveToLocalStorage(pid, filePath, content, comments, documentModel.baseContentHash);

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
	const handleStartNewFileRef = useCallback((startNewFile: (parentPath?: string) => void) => {
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

	// Save dirty content before pulling remote changes
	const handleBeforePull = useCallback(async () => {
		if (documentModel.isDirty && documentModel.filePath) {
			await performServerSave();
		}
	}, [documentModel, performServerSave]);

	// Reload the current file after a successful pull
	const handlePullComplete = useCallback(async () => {
		if (documentModel.filePath) {
			await loadFileFromServer(documentModel.filePath);
		}
	}, [documentModel, loadFileFromServer]);


	// Before anything that acts on a file's draft as the server has it (resolving a
	// conflict, a rename, a delete): if it's the open file, save what's on screen first.
	// If it can't be saved, nothing goes ahead: the change would act on an older draft and
	// the reload after it would drop what's on screen.
	const handleBeforeFileChange = useCallback(async (path: string) => {
		if (path === documentModel.filePath && documentModel.isDirty) {
			await performServerSave();
			if (documentModel.isDirty) {
				throw new Error('Your latest changes couldn\'t be saved, so nothing was changed. Try again once they save.');
			}
		}
	}, [documentModel, performServerSave]);

	// What a tree rename or delete of the open file sends as its base.
	const openDocumentBase = useCallback((path: string): string | null | undefined =>
		path === documentModel.filePath ? documentModel.baseContentHash : undefined
	, [documentModel]);

	// A commit takes the drafts as they are on the server: save the open file first and
	// hold further saves until the commit is done and the new base is in.
	const handleBeforeCommit = useCallback(async () => {
		if (documentModel.isDirty && documentModel.filePath) {
			await performServerSave();
		}
		holdSavesRef.current = true;
	}, [documentModel, performServerSave]);

	// `committedPaths`: the drafts the commit took, or null when it didn't land.
	const handleAfterCommit = useCallback(async (committedPaths: string[] | null) => {
		try {
			if (documentModel.filePath && committedPaths?.includes(documentModel.filePath)) {
				await refreshOpenDocumentBase();
			}
		} finally {
			holdSavesRef.current = false;
		}
		if (documentModel.isDirty) await performServerSave();
	}, [documentModel, refreshOpenDocumentBase, performServerSave]);

	const handleDraftResolved = useCallback(async (path: string) => {
		if (path === documentModel.filePath) {
			if (projectId) clearLocalStorage(projectId, path);
			await loadFileFromServer(path);
		}
	}, [documentModel, projectId, loadFileFromServer]);

	// An undone rename puts the file back at its old path: if the new one was open, open the old.
	const handleRenameUndone = useCallback(async (oldPath: string, newPath: string) => {
		if (documentModel.filePath === newPath) {
			if (projectId) clearLocalStorage(projectId, newPath);
			await loadFileFromServer(oldPath);
		}
	}, [documentModel, projectId, loadFileFromServer]);

	// Handle file deleted - clear selection if deleted file was open
	const handleFileDeleted = useCallback((deletedPath: string) => {
		if (documentModel.filePath === deletedPath) {
			documentModel.clear();
			if (projectId) saveSelectedFile(projectId, null);
			setLinkedEpicKey(undefined);
		}
	}, [documentModel, projectId]);

	// Handle receiving the renameFile function from FileBrowser
	const handleRenameFileRef = useCallback((renameFile: (path: string, newFilename: string, baseContentHash?: string | null) => Promise<string>) => {
		renameFileRef.current = renameFile;
	}, []);

	// Handle rename from EditorHeader
	const handleRename = useCallback(async (newFilename: string) => {
		if (!documentModel.filePath || !renameFileRef.current) return;

		const oldPath = documentModel.filePath;
		try {
			// The rename moves the draft the server has, so save what's on screen first, and
			// tell it what this document was made against so the old path conflicts if
			// someone changed it since.
			await handleBeforeFileChange(oldPath);
			const newPath = await renameFileRef.current(oldPath, newFilename, documentModel.baseContentHash);
			if (newPath === oldPath) return;

			// Show the file as the server has it now under its new name, and the changes
			// the rename made.
			if (projectId) migrateLocalStorageContent(projectId, oldPath, newPath);
			await loadFileFromServer(newPath);
			await gitStatusModel.refresh();
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			captureError(error, {
				type: 'file_rename_error',
				filePath: oldPath,
				newFilename,
				projectRef,
			});
			// Show user-friendly error - using alert for simplicity
			// (File operations typically succeed, so a dedicated UI component isn't warranted)
			alert(writeFailure(err, 'Failed to rename file', projectRef));
		}
	}, [projectRef, projectId, documentModel, handleBeforeFileChange, loadFileFromServer, gitStatusModel]);

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
		() => toMarkdown(documentModel.content as Descendant[], documentModel.comments),
		[documentModel.content, documentModel.comments]
	);

	// The chat sidebar only mounts while editing a file (see the render branches
	// below), so it contributes width only then. Until the ResizeObserver reports
	// a width, the maxes stay undefined and panels restore their stored widths.
	const chatVisible = !loadError && !isCreatingFile && !isCurrentFileDeleted && !!documentModel.filePath;
	const fileBrowserMaxWidth =
		containerWidth > 0
			? Math.max(FILE_BROWSER_MIN_WIDTH, containerWidth - (chatVisible ? chatWidth : 0) - CENTER_MIN_WIDTH)
			: undefined;
	const chatMaxWidth =
		containerWidth > 0
			? Math.max(CHAT_MIN_WIDTH, containerWidth - fileBrowserWidth - CENTER_MIN_WIDTH)
			: undefined;

	if (documentsElsewhere) {
		return (
			<Page projectRef={projectRef} activeTab="Pages">
				<div class={styles.emptyState}>
					<div class={styles.emptyStateContent}>
						<div class={styles.emptyStateIcon}><Icon name="folder" class="size-2xl" /></div>
						<div class={styles.emptyStateTitle}>These documents live on {project.ownerName || 'the owner'}'s computer</div>
						<div class={styles.emptyStateHint}>
							This project keeps its pages in a folder on its owner's machine, so they can't be opened here.
							The board is shared.
						</div>
					</div>
				</div>
			</Page>
		);
	}

	return (
		<Page projectRef={projectRef} activeTab="Pages">
			{saveError && (
				<SaveErrorBanner
					message={saveError.message}
					retrying={saveError.retrying}
					onRetry={saveError.refused ? undefined : handleRetryManual}
				/>
			)}
			<div class={styles.body} ref={bodyRef}>
				<div
					class={`${styles.drawerScrim} ${filesOpen ? styles.scrimOpen : ''} mobile-only`}
					onClick={() => setFilesOpen(false)}
					aria-hidden="true"
				/>
				<ResizablePanel
					storageKey="editor-file-browser"
					handleSide="right"
					defaultWidth={FILE_BROWSER_DEFAULT_WIDTH}
					minWidth={FILE_BROWSER_MIN_WIDTH}
					maxWidth={fileBrowserMaxWidth}
					onResize={setFileBrowserWidth}
					label="Resize file browser"
					class={`${styles.filesPanel} ${filesOpen ? styles.panelOpen : ''}`}
				>
					<DrawerHandle
						open={filesOpen}
						onToggle={() => setFilesOpen((open) => !open)}
						openLabel="Browse files"
						closeLabel="Close file drawer"
					/>
					<FileBrowser
						projectRef={projectRef}
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
						hasUnsavedChanges={documentModel.isDirty}
						onBeforePull={handleBeforePull}
						onBeforeCommit={handleBeforeCommit}
						onAfterCommit={handleAfterCommit}
						onBeforeFileChange={handleBeforeFileChange}
						openDocumentBase={openDocumentBase}
						onDraftResolved={handleDraftResolved}
						onRenameUndone={handleRenameUndone}
						onPullComplete={handlePullComplete}
						readOnly={!canEdit}
						isOwner={isOwner}
						class={styles.sidebar}
					/>
				</ResizablePanel>
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
									<button
										type="button"
										class={`${styles.errorDismissButton} mobile-only`}
										onClick={() => setFilesOpen(true)}
									>
										Browse files
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
									{canEdit && (
										<button
											class={styles.restoreButton}
											onClick={handleRestoreDeletedFile}
											disabled={isRestoring}
										>
											<Icon name="rotate-ccw" class="size-sm" />
											{isRestoring ? 'Restoring...' : 'Restore File'}
										</button>
									)}
									<button
										type="button"
										class={`${styles.errorDismissButton} mobile-only`}
										onClick={() => setFilesOpen(true)}
									>
										Browse files
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
								onRename={canEdit ? handleRename : undefined}
								linkedEpicKey={linkedEpicKey}
								creatingEpic={creatingEpic}
								onCreateEpic={canEdit ? handleCreateEpic : undefined}
								onViewEpic={handleViewEpic}
								onLinkEpic={canEdit ? () => setItemPickerOpen(true) : undefined}
								onToggleChat={() => setChatOpen(true)}
							/>
							<div class={styles.mainContent}>
								<div class={styles.editorArea}>
									<MarkdownEditor
										model={documentModel}
										comments={documentModel.comments}
										placeholder={canEdit ? 'Start writing...' : undefined}
										readOnly={!canEdit}
										onAddComment={canEdit ? handleAddComment : undefined}
										onReply={canEdit ? handleReplyToComment : undefined}
										onToggleResolved={canEdit ? handleToggleResolved : undefined}
										editorRef={editorRef}
									/>
								</div>
								<ResizablePanel
									storageKey="editor-chat"
									handleSide="left"
									defaultWidth={CHAT_DEFAULT_WIDTH}
									minWidth={CHAT_MIN_WIDTH}
									maxWidth={chatMaxWidth}
									onResize={setChatWidth}
									label="Resize chat sidebar"
									class={`${styles.chatPanel} ${chatOpen ? styles.panelOpen : ''}`}
								>
									<ErrorBoundary>
										<ChatSidebar
											documentContent={documentContentForChat}
											documentPath={documentModel.filePath}
											projectRef={projectRef}
											onApplyEdit={canEdit ? handleApplyEdit : undefined}
											onClose={() => setChatOpen(false)}
										/>
									</ErrorBoundary>
								</ResizablePanel>
							</div>
						</>
					) : (
						<div class={styles.emptyState}>
							<div class={styles.emptyStateContent}>
								<div class={styles.emptyStateIcon}><Icon name="file" class="size-2xl" /></div>
								<div class={styles.emptyStateTitle}>No file selected</div>
								<div class={styles.emptyStateHint}>
									{canEdit
										? 'Select a markdown file from the sidebar to start editing'
										: 'Select a markdown file from the sidebar to read it'}
								</div>
								<div class={`${styles.emptyStateActions} mobile-only`}>
									<Button onClick={() => setFilesOpen(true)}>Browse files</Button>
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
			{itemPickerOpen && canEdit && (
				<ItemPicker
					projectRef={projectRef}
					title="Link to an existing item"
					onSelect={handleLinkEpic}
					onClose={() => setItemPickerOpen(false)}
				/>
			)}
		</Page>
	);
}
