import { useMemo, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Page } from '@doc-platform/ui';
import {
	DocumentModel,
	useModel,
	saveToLocalStorage,
	loadFromLocalStorage,
	hasPersistedContent,
	clearLocalStorage,
} from '@doc-platform/models';
import { fetchClient } from '@doc-platform/fetch';
import { captureError } from '@doc-platform/telemetry';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { MarkdownEditor, mockComments, fromMarkdown, toMarkdown } from '../MarkdownEditor';
import { EditorHeader } from './EditorHeader';
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

export function Editor(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Document model - source of truth for editor content
	const documentModel = useMemo(() => new DocumentModel(), []);

	// Subscribe to model changes
	useModel(documentModel);

	// Track previous content for debounced localStorage save
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Track if we've attempted to restore the selected file
	const restoredRef = useRef(false);

	// Error state for file loading failures
	const [loadError, setLoadError] = useState<LoadError | null>(null);

	// Handle file selection from FileBrowser
	const handleFileSelect = useCallback(async (path: string) => {
		// Clear any previous error
		setLoadError(null);

		// Check for crash recovery
		if (hasPersistedContent(projectId, path)) {
			const useCached = window.confirm(
				'Unsaved changes were found for this file. Would you like to restore them?'
			);
			if (useCached) {
				const cached = loadFromLocalStorage(projectId, path);
				if (cached) {
					documentModel.loadDocument(projectId, path, cached);
					documentModel.dirty = true; // Mark dirty since not saved to server
					return;
				}
			}
			// User declined or cache was invalid - clear it
			clearLocalStorage(projectId, path);
		}

		// Load fresh from server
		try {
			const response = await fetchClient.get<{ content: string }>(
				`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`
			);
			const slateContent = fromMarkdown(response.content);
			documentModel.loadDocument(projectId, path, slateContent);
			// Save selected file to localStorage
			saveSelectedFile(projectId, path);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));

			// Send full error to backend for debugging
			captureError(error, {
				type: 'file_load_error',
				filePath: path,
				projectId,
			});

			// Show user-friendly error
			setLoadError({
				message: 'Unable to load this file. The file may be corrupted or contain unsupported formatting.',
				filePath: path,
			});
		}
	}, [projectId, documentModel]);

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

		documentModel.saving = true;
		try {
			const markdown = toMarkdown(documentModel.content as Parameters<typeof toMarkdown>[0]);
			await fetchClient.put(
				`/api/projects/${documentModel.projectId}/files?path=${encodeURIComponent(documentModel.filePath)}`,
				{ content: markdown }
			);
			documentModel.markSaved();
			clearLocalStorage(documentModel.projectId, documentModel.filePath);
		} catch (err) {
			console.error('Failed to save file:', err);
			// Could show error UI here
		} finally {
			documentModel.saving = false;
		}
	}, [documentModel]);

	// Debounced localStorage persistence on content change
	useEffect(() => {
		if (!documentModel.filePath || !documentModel.projectId) return;
		if (!documentModel.isDirty) return;

		// Clear previous timer
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
		}

		// Save to localStorage after 1 second of inactivity
		saveTimerRef.current = setTimeout(() => {
			saveToLocalStorage(
				documentModel.projectId!,
				documentModel.filePath!,
				documentModel.content
			);
		}, 1000);

		return () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
		};
	}, [documentModel.content, documentModel.filePath, documentModel.projectId, documentModel.isDirty]);

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

	return (
		<Page projectId={projectId} activeTab="Pages">
			<div class={styles.body}>
				<FileBrowser
					projectId={projectId}
					selectedPath={documentModel.filePath || undefined}
					onFileSelect={handleFileSelect}
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
					) : documentModel.filePath ? (
						<>
							<EditorHeader
								title={documentModel.title}
								filePath={documentModel.filePath}
								isDirty={documentModel.isDirty}
								saving={documentModel.saving}
								onSave={handleSave}
							/>
							<div class={styles.editorArea}>
								<MarkdownEditor
									model={documentModel}
									comments={mockComments}
									placeholder="Start writing..."
								/>
							</div>
						</>
					) : (
						<div class={styles.emptyState}>
							<div class={styles.emptyStateContent}>
								<div class={styles.emptyStateIcon}>📄</div>
								<div class={styles.emptyStateTitle}>No file selected</div>
								<div class={styles.emptyStateHint}>
									Select a markdown file from the sidebar to start editing
								</div>
							</div>
						</div>
					)}
				</main>
			</div>
		</Page>
	);
}
