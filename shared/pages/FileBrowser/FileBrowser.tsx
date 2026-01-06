import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { FileTreeModel, useModel } from '@doc-platform/models';
import { Button } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import styles from './FileBrowser.module.css';

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
	/** Additional CSS class */
	class?: string;
}

export function FileBrowser({
	projectId,
	selectedPath,
	onFileSelect,
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

	// Initialize model when projectId changes
	useEffect(() => {
		model.initialize(projectId);
	}, [model, projectId]);

	// Handle add folder
	const handleAddFolder = async () => {
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
	const handleItemClick = (path: string, type: 'file' | 'directory') => {
		if (type === 'directory') {
			model.toggleFolder(path);
		} else {
			onFileSelect?.(path);
		}
	};

	// Handle remove folder
	const handleRemoveFolder = async (folderPath: string, event: Event) => {
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

	// Empty state
	if (!model.loading && model.rootPaths.length === 0) {
		return (
			<div class={`${styles.container} ${className || ''}`}>
				<div class={styles.header}>Files</div>
				<div class={styles.emptyState}>
					<div class={styles.emptyIcon}>📁</div>
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

						return (
							<div
								key={file.path}
								class={`${styles.treeItem} ${isSelected ? styles.selected : ''} ${isRoot ? styles.rootItem : ''}`}
								style={{ '--depth': String(depth) } as JSX.CSSProperties}
								onClick={() => handleItemClick(file.path, file.type)}
							>
								{file.type === 'directory' ? (
									<span class={styles.folderIcon}>
										{isExpanded ? '▼' : '▶'} {isRoot ? '📁' : '📂'}
									</span>
								) : (
									<span class={styles.fileIcon}>
										📄
									</span>
								)}
								<span class={styles.fileName}>{file.name}</span>
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
