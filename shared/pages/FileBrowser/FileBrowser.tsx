import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { FileTreeModel, useModel, type GitStatusModel } from '@doc-platform/models';
import { Badge, Button, Icon } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import { GitStatusBar } from './GitStatusBar';
import { ConfirmDialog } from './ConfirmDialog';
import { FileItem } from './FileItem';
import { FolderItem } from './FolderItem';
import styles from './FileBrowser.module.css';

// Timing constants for blur handlers
const BLUR_SUBMIT_DELAY_MS = 200;
const RENAME_START_GRACE_PERIOD_MS = 300;

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
	/** Git status model for showing uncommitted changes */
	gitStatus?: GitStatusModel;
	/** Callback when file is selected */
	onFileSelect?: (path: string) => void;
	/** Callback when a new file is created */
	onFileCreated?: (path: string) => void;
	/** Callback when file creation is cancelled */
	onCancelNewFile?: () => void;
	/** Callback when a file is renamed via double-click in sidebar */
	onFileRenamed?: (oldPath: string, newPath: string) => void;
	/** Callback when a file or folder is deleted */
	onFileDeleted?: (path: string) => void;
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
	gitStatus,
	onFileSelect,
	onFileCreated,
	onCancelNewFile,
	onFileRenamed,
	onFileDeleted,
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
	useModel(gitStatus);

	// Local state for the inline new file input
	const [newFileName, setNewFileName] = useState('');
	const newFileInputRef = useRef<HTMLInputElement>(null);

	// Local state for inline rename input
	const [renameName, setRenameName] = useState('');
	const renameInputRef = useRef<HTMLInputElement>(null);

	// Local state for delete confirmation dialog
	const [deleteTarget, setDeleteTarget] = useState<{ path: string; type: 'file' | 'directory'; isUntracked: boolean } | null>(null);

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
			// Refresh git status to show the new file as untracked
			gitStatus?.refresh();
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
			// Refresh git status to show the renamed file as changed
			gitStatus?.refresh();
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

	// Handle remove folder from project (just removes from project, doesn't delete)
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

	// Perform the actual delete operation
	const performDelete = async (path: string, type: 'file' | 'directory'): Promise<void> => {
		const itemType = type === 'directory' ? 'folder' : 'file';

		try {
			await fetchClient.delete(
				`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`
			);
			model.reload();
			gitStatus?.refresh();
			onFileDeleted?.(path);
		} catch (err) {
			console.error(`Failed to delete ${itemType}:`, err);
			model.error = err instanceof Error ? err.message : `Failed to delete ${itemType}`;
		}
	};

	// Handle delete click - check if confirmation is needed
	const handleDeleteClick = (path: string, type: 'file' | 'directory', event: Event): void => {
		event.stopPropagation();

		// Check git status to determine if confirmation is needed
		const changeStatus = gitStatus?.getChangeStatus(path);
		const isUntracked = gitStatus?.isUntracked(path);
		const hasChanges = changeStatus !== undefined || isUntracked;

		if (hasChanges) {
			// Untracked or modified files need confirmation (data loss)
			setDeleteTarget({ path, type, isUntracked: isUntracked ?? false });
		} else {
			// Tracked files without changes can be deleted directly (recoverable from git)
			performDelete(path, type);
		}
	};

	// Confirm delete for files that need it
	const handleDeleteConfirm = async (): Promise<void> => {
		if (!deleteTarget) return;
		await performDelete(deleteTarget.path, deleteTarget.type);
		setDeleteTarget(null);
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
			{gitStatus && <GitStatusBar gitStatus={gitStatus} />}
			<div class={styles.header}>
				<span>Files</span>
				{gitStatus && gitStatus.changedCount > 0 && (
					<Badge class="variant-warning size-sm">{gitStatus.changedCount}</Badge>
				)}
			</div>
			<div class={styles.content}>
				<div class={styles.tree}>
					{model.files.map((file) => {
						const depth = model.getDepth(file.path);
						const isExpanded = model.isExpanded(file.path);
						const isSelected = file.path === selectedPath;
						const isRoot = model.isRootPath(file.path);
						const isFolder = file.type === 'directory';
						const isRenaming = model.pendingRename?.path === file.path;
						const changeStatus = gitStatus?.getChangeStatus(file.path) ?? undefined;
						const isDeleted = changeStatus === 'deleted';

						return (
							<>
								{isFolder ? (
									<FolderItem
										key={file.path}
										name={file.name}
										depth={depth}
										isExpanded={isExpanded}
										isRoot={isRoot}
										onClick={() => handleItemClick(file.path, 'directory')}
										onAddFileClick={(e) => handleNewFileInFolder(file.path, e)}
										onDeleteClick={(e) => handleDeleteClick(file.path, 'directory', e)}
										onRemoveClick={(e) => handleRemoveFolder(file.path, e)}
									/>
								) : (
									<FileItem
										key={file.path}
										path={file.path}
										name={file.name}
										depth={depth}
										isSelected={isSelected}
										isRenaming={isRenaming}
										renameValue={renameName}
										renameInputRef={renameInputRef}
										changeStatus={changeStatus}
										isDeleted={isDeleted}
										onClick={() => handleItemClick(file.path, 'file')}
										onDoubleClick={(e) => handleFileDoubleClick(file.path, e)}
										onRenameInput={(e) => setRenameName((e.target as HTMLInputElement).value)}
										onRenameKeyDown={handleRenameKeyDown}
										onRenameBlur={handleRenameBlur}
										onDeleteClick={(e) => handleDeleteClick(file.path, 'file', e)}
									/>
								)}
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

			{/* Delete confirmation dialog */}
			<ConfirmDialog
				open={deleteTarget !== null}
				title={`Delete ${deleteTarget?.type === 'directory' ? 'folder' : 'file'}?`}
				message={deleteTarget?.path}
				warning={deleteTarget?.isUntracked
					? "This file has never been committed and cannot be recovered."
					: "This file has uncommitted changes that will be lost."
				}
				confirmText="Delete"
				onConfirm={handleDeleteConfirm}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
