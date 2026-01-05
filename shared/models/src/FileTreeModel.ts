/**
 * FileTreeModel - Observable state for file browser
 *
 * Pure JS model with no Preact dependencies.
 * Handles file tree loading, expansion state, and localStorage persistence.
 */

import { Model } from './Model';
import { prop } from './prop';
import { fetchClient } from '@doc-platform/fetch';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
	modifiedAt?: string;
}

/** Nested tree for expanded paths - compact format */
export type ExpandedTree = { [name: string]: ExpandedTree };

interface FileTreeResponse {
	files: FileEntry[];
	expanded: ExpandedTree;
	rootPaths: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree conversion utilities (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TREE_DEPTH = 50;

/** Convert nested tree to flat array of paths */
export function expandedTreeToPaths(tree: ExpandedTree, basePath: string = '', depth: number = 0): string[] {
	if (depth >= MAX_TREE_DEPTH) {
		return [];
	}
	const paths: string[] = [];
	for (const [name, subtree] of Object.entries(tree)) {
		const path = basePath ? `${basePath}/${name}` : `/${name}`;
		paths.push(path);
		paths.push(...expandedTreeToPaths(subtree, path, depth + 1));
	}
	return paths;
}

/** Convert flat array of paths to nested tree */
export function pathsToExpandedTree(paths: string[]): ExpandedTree {
	const tree: ExpandedTree = {};
	for (const path of paths) {
		const parts = path.split('/').filter(Boolean);
		let current = tree;
		for (const part of parts) {
			if (!current[part]) {
				current[part] = {};
			}
			current = current[part];
		}
	}
	return tree;
}

/** Add a path to the expanded tree */
export function addPathToTree(tree: ExpandedTree, path: string): ExpandedTree {
	const result = JSON.parse(JSON.stringify(tree)) as ExpandedTree;
	const parts = path.split('/').filter(Boolean);
	let current = result;
	for (const part of parts) {
		if (!current[part]) {
			current[part] = {};
		}
		current = current[part];
	}
	return result;
}

/** Remove a path and its descendants from the expanded tree */
export function removePathFromTree(tree: ExpandedTree, path: string): ExpandedTree {
	const result = JSON.parse(JSON.stringify(tree)) as ExpandedTree;
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 0) return {};

	let current = result;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i] as string;
		if (!current[part]) return result; // Path doesn't exist
		current = current[part];
	}
	const lastPart = parts[parts.length - 1] as string;
	delete current[lastPart];
	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage helpers
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'fileBrowser.expanded';

function getStorage(): typeof globalThis.localStorage | null {
	return globalThis.localStorage ?? null;
}

function loadExpandedTreeFromStorage(projectId: string): ExpandedTree {
	try {
		const storage = getStorage();
		if (!storage) return {};
		const stored = storage.getItem(STORAGE_KEY);
		if (stored) {
			const all = JSON.parse(stored) as Record<string, ExpandedTree>;
			return all[projectId] || {};
		}
	} catch {
		// Ignore parse errors
	}
	return {};
}

function saveExpandedTreeToStorage(projectId: string, tree: ExpandedTree): void {
	try {
		const storage = getStorage();
		if (!storage) return;
		const stored = storage.getItem(STORAGE_KEY);
		const all = stored ? (JSON.parse(stored) as Record<string, ExpandedTree>) : {};
		all[projectId] = tree;
		storage.setItem(STORAGE_KEY, JSON.stringify(all));
	} catch {
		// Ignore storage errors
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

/** Calculate depth relative to root paths */
export function getDepthForPath(path: string, rootPaths: string[]): number {
	for (const rootPath of rootPaths) {
		if (path === rootPath) return 0;
		const prefix = rootPath === '/' ? '/' : rootPath + '/';
		if (path.startsWith(prefix)) {
			const relative = path.slice(rootPath === '/' ? 1 : rootPath.length + 1);
			return relative.split('/').filter(Boolean).length;
		}
	}
	return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// FileTreeModel
// ─────────────────────────────────────────────────────────────────────────────

export class FileTreeModel extends Model {
	@prop accessor projectId!: string;
	@prop accessor rootPaths!: string[];
	@prop accessor files!: FileEntry[];
	@prop accessor expanded!: ExpandedTree;
	@prop accessor loading!: boolean;
	@prop accessor error!: string | null;

	constructor() {
		super({
			projectId: '',
			rootPaths: [],
			files: [],
			expanded: {},
			loading: false,
			error: null,
		});
	}

	/**
	 * Initialize the model with a project ID and load data
	 */
	async initialize(projectId: string): Promise<void> {
		if (this.projectId === projectId) return;

		this.projectId = projectId;
		this.files = [];
		this.expanded = {};
		this.rootPaths = [];
		this.error = null;

		await this.loadTree();
	}

	/**
	 * Check if a path is expanded
	 */
	isExpanded(path: string): boolean {
		const parts = path.split('/').filter(Boolean);
		let current = this.expanded;
		for (const part of parts) {
			if (!current[part]) return false;
			current = current[part];
		}
		return true;
	}

	/**
	 * Check if a path is a root path
	 */
	isRootPath(path: string): boolean {
		return this.rootPaths.includes(path);
	}

	/**
	 * Get depth for a path (for indentation)
	 */
	getDepth(path: string): number {
		return getDepthForPath(path, this.rootPaths);
	}

	/**
	 * Toggle a folder's expanded state
	 */
	async toggleFolder(path: string): Promise<void> {
		if (this.isExpanded(path)) {
			this.collapseFolder(path);
		} else {
			await this.expandFolder(path);
		}
	}

	/**
	 * Expand a folder and load its children
	 */
	async expandFolder(path: string): Promise<void> {
		if (this.isExpanded(path)) return;

		// Add to expanded tree and reload
		const newExpanded = addPathToTree(this.expanded, path);
		saveExpandedTreeToStorage(this.projectId, newExpanded);
		await this.loadTree();
	}

	/**
	 * Collapse a folder and remove its children from view
	 */
	collapseFolder(path: string): void {
		if (!this.isExpanded(path)) return;

		// Remove all descendants from files array
		const prefix = path === '/' ? '/' : path + '/';
		const files = this.files.filter(
			(f) => f.path === path || !f.path.startsWith(prefix)
		);

		// Remove from expanded tree
		const newExpanded = removePathFromTree(this.expanded, path);

		this.files = files;
		this.expanded = newExpanded;
		saveExpandedTreeToStorage(this.projectId, newExpanded);
	}

	/**
	 * Reload the entire tree (e.g., after external file system changes)
	 */
	async reload(): Promise<void> {
		await this.loadTree();
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Private methods
	// ─────────────────────────────────────────────────────────────────────────

	private async loadTree(): Promise<void> {
		this.loading = true;
		this.error = null;

		try {
			// Get saved expanded tree from localStorage
			const savedExpanded = loadExpandedTreeFromStorage(this.projectId);

			// Single request to server - returns ready-to-render data
			const data = await fetchClient.post<FileTreeResponse>(
				`/api/projects/${this.projectId}/tree`,
				{ expanded: savedExpanded }
			);

			this.files = data.files;
			this.expanded = data.expanded;
			this.rootPaths = data.rootPaths;

			// Persist validated expanded tree (server removes invalid paths)
			saveExpandedTreeToStorage(this.projectId, data.expanded);
		} catch (err) {
			console.error('Failed to load file tree:', err);
			this.error = 'Failed to load files';
		} finally {
			this.loading = false;
		}
	}
}
