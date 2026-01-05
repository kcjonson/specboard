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
				{model.loading ? (
					<div class={styles.loading}>Loading...</div>
				) : (
					<div class={styles.tree}>
						{model.files.map((file) => {
							const depth = model.getDepth(file.path);
							const isExpanded = model.isExpanded(file.path);
							const isSelected = file.path === selectedPath;
							const isRoot = model.isRootPath(file.path);

							return (
								<div
									key={file.path}
									class={`${styles.treeItem} ${isSelected ? styles.selected : ''}`}
									style={{ paddingLeft: `${depth * 16 + 8}px` }}
									onClick={() => handleItemClick(file.path, file.type)}
								>
									{file.type === 'directory' ? (
										<span class={styles.folderIcon}>
											{isExpanded ? '▼' : '▶'} {isRoot ? '📁' : '📂'}
										</span>
									) : (
										<span class={styles.fileIcon} style={{ marginLeft: 'var(--space-4)' }}>
											📄
										</span>
									)}
									<span class={styles.fileName}>{file.name}</span>
								</div>
							);
						})}
					</div>
				)}
				{model.error && <div class={styles.error}>{model.error}</div>}
			</div>
		</div>
	);
}
