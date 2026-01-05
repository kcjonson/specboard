import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient } from '@doc-platform/fetch';
import { Button } from '@doc-platform/ui';
import styles from './FileBrowser.module.css';

interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
	modifiedAt?: string;
}

interface ProjectStorage {
	storageMode: 'local' | 'cloud';
	repository: {
		localPath?: string;
		branch?: string;
	};
	rootPaths: string[];
}

interface FileTreeResponse {
	path: string;
	entries: FileEntry[];
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
	const [project, setProject] = useState<ProjectStorage | null>(null);
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Fetch project to get storage config
	const fetchProject = useCallback(async () => {
		try {
			const data = await fetchClient.get<ProjectStorage>(`/api/projects/${projectId}`);
			setProject(data);
		} catch (err) {
			console.error('Failed to fetch project:', err);
			setError('Failed to load project');
		}
	}, [projectId]);

	// Fetch files at a specific path
	const fetchFiles = useCallback(async (path: string) => {
		try {
			const data = await fetchClient.get<FileTreeResponse>(
				`/api/projects/${projectId}/tree?path=${encodeURIComponent(path)}`
			);
			return data.entries;
		} catch (err) {
			console.error('Failed to fetch files:', err);
			return [];
		}
	}, [projectId]);

	// Load initial files for all root paths
	const loadRootFiles = useCallback(async () => {
		if (!project || project.rootPaths.length === 0) {
			setFiles([]);
			setLoading(false);
			return;
		}

		setLoading(true);
		try {
			const allFiles: FileEntry[] = [];
			for (const rootPath of project.rootPaths) {
				// Add root folder entry - children are loaded on expand
				allFiles.push({
					name: rootPath === '/' ? 'Root' : rootPath.split('/').pop() || rootPath,
					path: rootPath,
					type: 'directory',
				});
			}
			setFiles(allFiles);
			// Auto-expand root paths
			setExpandedPaths(new Set(project.rootPaths));
		} catch (err) {
			setError('Failed to load files');
		}
		setLoading(false);
	}, [project]);

	// Toggle folder expand/collapse
	const toggleFolder = useCallback(async (path: string) => {
		const newExpanded = new Set(expandedPaths);
		if (newExpanded.has(path)) {
			newExpanded.delete(path);
		} else {
			newExpanded.add(path);
			// Load children if not already loaded
			const children = await fetchFiles(path);
			setFiles((prev: FileEntry[]) => {
				// Find where to insert children
				const index = prev.findIndex((f: FileEntry) => f.path === path);
				if (index === -1) return prev;

				// Remove existing children at this path
				const pathPrefix = path === '/' ? '/' : path + '/';
				const withoutChildren = prev.filter(
					(f: FileEntry) => f.path === path || !f.path.startsWith(pathPrefix)
				);

				// Insert new children after parent
				const before = withoutChildren.slice(0, index + 1);
				const after = withoutChildren.slice(index + 1);
				return [...before, ...children, ...after];
			});
		}
		setExpandedPaths(newExpanded);
	}, [expandedPaths, fetchFiles]);

	// Handle add folder (Electron only - browser users must use cloud mode)
	// TODO: Use platform.System.showOpenDialog({ directory: true }) for native folder picker
	// TODO: In browser, hide this button and show "Connect Repository" instead
	const handleAddFolder = useCallback(async () => {
		const path = window.prompt('Enter folder path (absolute path to a git repository folder):');
		if (!path) return;

		try {
			setError(null);
			const result = await fetchClient.post<ProjectStorage>(
				`/api/projects/${projectId}/folders`,
				{ path }
			);
			setProject(result);
		} catch (err) {
			if (err && typeof err === 'object') {
				const error = err as { code?: string; error?: string };
				if (error.code === 'NOT_GIT_REPO') {
					setError('Folder is not inside a git repository');
				} else if (error.code === 'DIFFERENT_REPO') {
					setError('Folder must be in the same git repository');
				} else if (error.code === 'FOLDER_NOT_FOUND') {
					setError('Folder does not exist');
				} else if (error.code === 'NOT_DIRECTORY') {
					setError('Path is not a directory');
				} else {
					setError(error.error || 'Failed to add folder');
				}
			} else {
				setError('Failed to add folder');
			}
		}
	}, [projectId]);

	// Initial load
	useEffect(() => {
		fetchProject();
	}, [fetchProject]);

	// Load files when project changes
	useEffect(() => {
		if (project) {
			loadRootFiles();
		}
	}, [project, loadRootFiles]);

	// Calculate depth for indentation
	const getDepth = (path: string): number => {
		if (!project) return 0;
		for (const rootPath of project.rootPaths) {
			if (path === rootPath) return 0;
			if (path.startsWith(rootPath === '/' ? '/' : rootPath + '/')) {
				const relative = path.slice(rootPath.length);
				return relative.split('/').filter(Boolean).length;
			}
		}
		return 0;
	};

	// Check if path is a root path
	const isRootPath = (path: string): boolean => {
		return project?.rootPaths.includes(path) || false;
	};

	// Empty state
	if (!loading && (!project || project.rootPaths.length === 0)) {
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
					{error && <div class={styles.error}>{error}</div>}
				</div>
			</div>
		);
	}

	return (
		<div class={`${styles.container} ${className || ''}`}>
			<div class={styles.header}>Files</div>
			<div class={styles.content}>
				{loading ? (
					<div class={styles.loading}>Loading...</div>
				) : (
					<div class={styles.tree}>
						{files.map((file: FileEntry) => {
							const depth = getDepth(file.path);
							const isExpanded = expandedPaths.has(file.path);
							const isSelected = file.path === selectedPath;
							const isRoot = isRootPath(file.path);

							return (
								<div
									key={file.path}
									class={`${styles.treeItem} ${isSelected ? styles.selected : ''}`}
									style={{ paddingLeft: `${depth * 16 + 8}px` }}
									onClick={() => {
										if (file.type === 'directory') {
											toggleFolder(file.path);
										} else {
											onFileSelect?.(file.path);
										}
									}}
								>
									{file.type === 'directory' ? (
										<span class={styles.folderIcon}>
											{isExpanded ? '▼' : '▶'} {isRoot ? '📁' : '📂'}
										</span>
									) : (
										<span class={styles.fileIcon} style={{ marginLeft: '1rem' }}>
											📄
										</span>
									)}
									<span class={styles.fileName}>{file.name}</span>
								</div>
							);
						})}
					</div>
				)}
				{error && <div class={styles.error}>{error}</div>}
			</div>
			<div class={styles.footer}>
				<Button onClick={handleAddFolder} class={styles.addButton}>
					+ Add Folder
				</Button>
			</div>
		</div>
	);
}
