import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { FileTreeModel, useModel } from '@doc-platform/models';
import { Button, Icon } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import styles from './FileBrowser.module.css';

// Timing constants for blur handlers and rename interactions
const BLUR_SUBMIT_DELAY_MS = 200; // Delay before blur triggers submit (allows clicks to fire first)
const RENAME_START_GRACE_PERIOD_MS = 200; // Ignore blur events within this time after rename starts

/**
 * Ensure filename has a markdown extension (.md or .mdx).
 * Adds .md if no extension is present.
 */
function ensureMarkdownExtension(filename: string): string {
	const trimmed = filename.trim();
	if (trimmed.endsWith('.md') || trimmed.endsWith('.mdx')) {
		return trimmed;
	}
	return `${trimmed}.md`;
}

interface ProjectStorage {
	storageMode: 'local' | 'cloud';
	repository: {
		localPath?: string;
		branch?: string;
	};
	rootPaths: string[];
}

export interface FileBrowserProps {
	/** Project ID */
	projectId: string;
	/** Currently selected file path */
	selectedPath?: string;
	/** Callback when file is selected */
	onFileSelect?: (path: string) => void;
	/** Callback when a new file is created */
	onFileCreated?: (path: string) => void;
	/** Callback when file creation is cancelled */
	onCancelNewFile?: () => void;
	/** Callback when a file is renamed via double-click in sidebar */
	onFileRenamed?: (oldPath: string, newPath: string) => void;
	/** Callback to receive the startNewFile function. parentPath is optional - uses first rootPath if not provided */
	onStartNewFileRef?: (startNewFile: (parentPath?: string) => void) => void;
	/** Callback to receive the renameFile function. Returns new path on success */
	onRenameFileRef?: (renameFile: (path: string, newFilename: string) => Promise<string>) => void;
	/** Additional CSS class */
	class?: string;
}

export function FileBrowser({
	projectId,
	selectedPath,
	onFileSelect,
	onFileCreated,
	onCancelNewFile,
	onFileRenamed,
	onStartNewFileRef,
	onRenameFileRef,
	class: className,
}: FileBrowserProps): JSX.Element {
	// Create model instance once per component
	const modelRef = useRef<FileTreeModel | null>(null);
	if (!modelRef.current) {
		modelRef.current = new FileTreeModel();
	}
	const model = modelRef.current;

	// Subscribe to model changes
	useModel(model);

	// Local state for the inline new file input
	const [newFileName, setNewFileName] = useState('');
	const newFileInputRef = useRef<HTMLInputElement>(null);

	// Local state for inline rename input
	const [renameName, setRenameName] = useState('');
	const renameInputRef = useRef<HTMLInputElement>(null);

	// Initialize model when projectId changes
	useEffect(() => {
		model.initialize(projectId);
	}, [model, projectId]);

	// Expose startNewFile function to parent
	// If no parentPath provided, uses first rootPath
	const handleStartNewFile = useCallback((parentPath?: string) => {
		const targetPath = parentPath || model.rootPaths[0];
		if (targetPath) {
			model.startNewFile(targetPath);
		}
	}, [model]);

	useEffect(() => {
		onStartNewFileRef?.(handleStartNewFile);
	}, [onStartNewFileRef, handleStartNewFile]);

	// Expose renameFile function to parent
	const handleRenameFile = useCallback(async (path: string, newFilename: string): Promise<string> => {
		// Get parent directory from path
		const lastSlash = path.lastIndexOf('/');
		const parentPath = lastSlash > 0 ? path.slice(0, lastSlash) : '/';
		const finalName = ensureMarkdownExtension(newFilename);
		const newPath = `${parentPath}/${finalName}`;

		// If name unchanged, just return
		if (newPath === path) {
			return path;
		}

		// Call API directly (simpler than going through model for external calls)
		await fetchClient.put<{ success: boolean }>(
			`/api/projects/${projectId}/files/rename`,
			{ oldPath: path, newPath }
		);

		// Reload tree to show renamed file
		await model.reload();

		return newPath;
	}, [model, projectId]);

	useEffect(() => {
		onRenameFileRef?.(handleRenameFile);
	}, [onRenameFileRef, handleRenameFile]);

	// Focus input and set default name when pending file changes
	useEffect(() => {
		if (model.pendingNewFile) {
			setNewFileName(model.pendingNewFile.defaultName);
			// Focus input after render
			requestAnimationFrame(() => {
				const input = newFileInputRef.current;
				if (input) {
					input.focus();
					// Select filename without extension
					const dotIndex = model.pendingNewFile!.defaultName.lastIndexOf('.');
					if (dotIndex > 0) {
						input.setSelectionRange(0, dotIndex);
					} else {
						input.select();
					}
				}
			});
		}
	}, [model.pendingNewFile]);

	// Focus input and set current name when rename starts
	useEffect(() => {
		if (model.pendingRename) {
			renameStartTimeRef.current = Date.now();
			setRenameName(model.pendingRename.currentName);
			// Focus input after render - use longer delay to avoid click interference
			setTimeout(() => {
				const input = renameInputRef.current;
				if (input) {
					input.focus();
					// Select filename without extension
					const dotIndex = model.pendingRename!.currentName.lastIndexOf('.');
					if (dotIndex > 0) {
						input.setSelectionRange(0, dotIndex);
					} else {
						input.select();
					}
				}
			}, 50);
		}
	}, [model.pendingRename]);

	// Handle new file input submit
	const handleNewFileSubmit = async (): Promise<void> => {
		if (!newFileName.trim()) {
			model.cancelNewFile();
			return;
		}

		try {
			const path = await model.commitNewFile(newFileName);
			onFileCreated?.(path);
		} catch {
			// Error is set on model, will show in UI
		}
	};

	// Handle new file input keydown
	const handleNewFileKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleNewFileSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			model.cancelNewFile();
			onCancelNewFile?.();
		}
	};

	// Handle new file input blur
	const handleNewFileBlur = (): void => {
		// Delay to allow click events to fire first
		setTimeout(() => {
			if (model.pendingNewFile) {
				handleNewFileSubmit();
			}
		}, BLUR_SUBMIT_DELAY_MS);
	};

	// Handle rename submit
	const handleRenameSubmit = async (): Promise<void> => {
		if (!renameName.trim()) {
			model.cancelRename();
			return;
		}

		const oldPath = model.pendingRename?.path;
		try {
			const newPath = await model.commitRename(renameName);
			// Notify parent of the rename
			if (oldPath) {
				onFileRenamed?.(oldPath, newPath);
			}
		} catch {
			// Error is set on model, will show in UI
		}
	};

	// Handle rename keydown
	const handleRenameKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleRenameSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			model.cancelRename();
		}
	};

	// Track if we just started renaming (to ignore initial blur)
	const renameStartTimeRef = useRef<number>(0);

	// Handle rename input blur
	const handleRenameBlur = (): void => {
		// Ignore blur if rename just started - this prevents the double-click
		// events from immediately closing the input
		const timeSinceStart = Date.now() - renameStartTimeRef.current;
		if (timeSinceStart < RENAME_START_GRACE_PERIOD_MS) {
			// Re-focus the input
			requestAnimationFrame(() => {
				renameInputRef.current?.focus();
			});
			return;
		}

		// Delay to allow click events to fire first
		setTimeout(() => {
			if (model.pendingRename) {
				handleRenameSubmit();
			}
		}, BLUR_SUBMIT_DELAY_MS);
	};

	// Handle double-click on file to start rename
	const handleFileDoubleClick = (path: string, event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		model.startRename(path);
	};

	// Handle "+" button click on a folder
	const handleNewFileInFolder = (folderPath: string, event: Event): void => {
		event.stopPropagation();
		model.startNewFile(folderPath);
	};

	// Handle add folder
	const handleAddFolder = async (): Promise<void> => {
		const path = window.prompt('Enter folder path (absolute path to a git repository folder):');
		if (!path) return;

		try {
			await fetchClient.post<ProjectStorage>(
				`/api/projects/${projectId}/folders`,
				{ path }
			);
			// Reload the tree to pick up new folder
			model.reload();
		} catch (err) {
			console.error('Failed to add folder:', err);
			model.error = err instanceof Error ? err.message : 'Failed to add folder';
		}
	};

	// Handle item click
	const handleItemClick = (path: string, type: 'file' | 'directory'): void => {
		// Don't handle click if we're renaming this file
		if (model.pendingRename?.path === path) {
			return;
		}
		if (type === 'directory') {
			model.toggleFolder(path);
		} else {
			onFileSelect?.(path);
		}
	};

	// Handle remove folder
	const handleRemoveFolder = async (folderPath: string, event: Event): Promise<void> => {
		event.stopPropagation();

		try {
			await fetchClient.delete<ProjectStorage>(
				`/api/projects/${projectId}/folders?path=${encodeURIComponent(folderPath)}`
			);
			model.reload();
		} catch (err) {
			console.error('Failed to remove folder:', err);
			model.error = err instanceof Error ? err.message : 'Failed to remove folder';
		}
	};

	// Helper to render the pending new file input
	const renderPendingNewFile = (): JSX.Element | null => {
		if (!model.pendingNewFile) return null;

		const depth = model.getDepth(model.pendingNewFile.parentPath) + 1;

		return (
			<div
				class={styles.newFileItem}
				style={{ '--depth': String(depth) } as JSX.CSSProperties}
			>
				<span class={styles.newFileIcon}><Icon name="file" class="size-sm" /></span>
				<input
					ref={newFileInputRef}
					type="text"
					class={styles.newFileInput}
					value={newFileName}
					onInput={(e) => setNewFileName((e.target as HTMLInputElement).value)}
					onKeyDown={handleNewFileKeyDown}
					onBlur={handleNewFileBlur}
					placeholder="filename.md"
					aria-label="New file name"
				/>
			</div>
		);
	};

	// Empty state
	if (!model.loading && model.rootPaths.length === 0) {
		return (
			<div class={`${styles.container} ${className || ''}`}>
				<div class={styles.header}>Files</div>
				<div class={styles.emptyState}>
					<div class={styles.emptyIcon}><Icon name="folder" class="size-2xl" /></div>
					<div class={styles.emptyTitle}>No folders added</div>
					<Button onClick={handleAddFolder} class={styles.addButton}>
						+ Add Folder
					</Button>
					<div class={styles.emptyHint}>
						Add a folder from a git repository to get started.
					</div>
					{model.error && <div class={styles.error}>{model.error}</div>}
				</div>
			</div>
		);
	}

	// Check if we should show the pending file input after a given path
	const shouldShowPendingAfter = (filePath: string): boolean => {
		if (!model.pendingNewFile) return false;
		return filePath === model.pendingNewFile.parentPath;
	};

	return (
		<div class={`${styles.container} ${className || ''}`}>
			<div class={styles.header}>Files</div>
			<div class={styles.content}>
				<div class={styles.tree}>
					{model.files.map((file) => {
						const depth = model.getDepth(file.path);
						const isExpanded = model.isExpanded(file.path);
						const isSelected = file.path === selectedPath;
						const isRoot = model.isRootPath(file.path);
						const isFolder = file.type === 'directory';
						const isRenaming = model.pendingRename?.path === file.path;

						return (
							<>
								<div
									key={file.path}
									class={`${styles.treeItem} ${isSelected ? styles.selected : ''} ${isFolder ? styles.folderItem : ''}`}
									style={{ '--depth': String(depth) } as JSX.CSSProperties}
									onClick={() => handleItemClick(file.path, file.type)}
									onDblClick={!isFolder ? (e) => handleFileDoubleClick(file.path, e) : undefined}
								>
									{isFolder ? (
										<span class={styles.folderIcon}>
											<Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} class="size-xs" />
											<Icon name={isExpanded ? 'folder-open' : 'folder'} class="size-sm" />
										</span>
									) : (
										<span class={styles.fileIcon}>
											<Icon name="file" class="size-sm" />
										</span>
									)}
									{isRenaming ? (
										<input
											ref={renameInputRef}
											type="text"
											class={styles.newFileInput}
											value={renameName}
											onInput={(e) => setRenameName((e.target as HTMLInputElement).value)}
											onKeyDown={handleRenameKeyDown}
											onBlur={handleRenameBlur}
											placeholder="filename.md"
											aria-label="Rename file"
										/>
									) : (
										<span class={styles.fileName}>{file.name}</span>
									)}
									{isFolder && (
										<div class={styles.folderActions}>
											<button
												class={styles.addFileButton}
												onClick={(e) => handleNewFileInFolder(file.path, e)}
												title="New file in folder"
												aria-label="New file in folder"
											>
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<line x1="12" y1="5" x2="12" y2="19" />
													<line x1="5" y1="12" x2="19" y2="12" />
												</svg>
											</button>
											{isRoot && (
												<button
													class={styles.removeButton}
													onClick={(e) => handleRemoveFolder(file.path, e)}
													title="Remove folder"
													aria-label="Remove folder"
												>
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
														<polyline points="3 6 5 6 21 6" />
														<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
													</svg>
												</button>
											)}
										</div>
									)}
								</div>
								{shouldShowPendingAfter(file.path) && renderPendingNewFile()}
							</>
						);
					})}
				</div>
				{model.error && <div class={styles.error}>{model.error}</div>}
			</div>
			<div class={`${styles.statusBar} ${model.loading ? styles.statusBarVisible : ''}`}>
				Loading...
			</div>
		</div>
	);
}
