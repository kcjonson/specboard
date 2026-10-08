/**
 * Shared utilities for storage handlers
 */

import path from 'path';
import {
	type ProjectAccess,
	type ProjectResponse,
	type RepositoryConfig,
	isLocalRepository,
	isCloudRepository,
} from '@specboard/db';
import { LocalStorageProvider } from '../../services/storage/local-provider.ts';
import { CloudStorageProvider } from '../../services/storage/cloud-provider.ts';
import type { StorageProvider } from '../../services/storage/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Storage provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The storage a caller reaches for a project, or null when there is none for them.
 *
 * Cloud storage is the repository's synced checkout plus the caller's own pending
 * changes. A local project's files live on its owner's machine, so only the owner
 * reaches them; to a member a local project is board-only, the same as one with no
 * storage (docs/specs/multi-user-collaboration.md, What storage mode shares).
 */
export function getStorageProvider(
	project: ProjectResponse,
	userId: string,
	access: Pick<ProjectAccess, 'grantedRole'>
): StorageProvider | null {
	const repo = project.repository as RepositoryConfig | Record<string, never>;

	if (isLocalRepository(repo)) {
		return access.grantedRole === 'owner' ? new LocalStorageProvider(repo.localPath) : null;
	}

	if (isCloudRepository(repo)) {
		return new CloudStorageProvider(project.id, userId, {
			repositoryOwner: repo.remote.owner,
			repositoryName: repo.remote.repo,
			defaultBranch: repo.branch,
		});
	}

	return null; // storage_mode: 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft bases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A client's `baseContentHash`: a committed file's sha1, the marker storage migration 003
 * gave drafts whose file was gone, or null (nothing committed). Undefined (absent) means
 * the client doesn't know; anything else is refused.
 */
export function readDraftBase(value: unknown): { ok: true; base: string | null | undefined } | { ok: false } {
	if (value === undefined || value === null) return { ok: true, base: value };
	if (typeof value === 'string' && (/^[0-9a-f]{40}$/.test(value) || value === 'missing-before-migration')) {
		return { ok: true, base: value };
	}
	return { ok: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Path validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a path and check for traversal attempts
 * Returns null if path contains traversal sequences
 */
export function normalizePath(inputPath: string): string | null {
	// Check for traversal attempts BEFORE normalization
	// This catches encoded sequences and edge cases that normalize might resolve
	if (inputPath.includes('..')) {
		return null;
	}

	// Normalize the path
	const normalized = path.posix.normalize(inputPath);

	// Double-check after normalization (belt and suspenders)
	if (normalized.includes('..')) {
		return null;
	}

	// Ensure path starts with /
	return normalized.startsWith('/') ? normalized : '/' + normalized;
}

/**
 * Check if a path is within one of the project's root paths
 */
export function isPathWithinRoots(targetPath: string, rootPaths: string[]): boolean {
	const normalized = normalizePath(targetPath);
	if (!normalized) return false;

	const normalizedTarget = normalized.replace(/\/+$/, '') || '/';

	for (const root of rootPaths) {
		const normalizedRoot = (root.replace(/\/+$/, '') || '/');
		// Root '/' contains everything
		if (normalizedRoot === '/') return true;
		if (normalizedTarget === normalizedRoot) return true;
		if (normalizedTarget.startsWith(normalizedRoot + '/')) return true;
	}
	return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded tree utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Nested tree structure for expanded paths */
export type ExpandedTree = { [name: string]: ExpandedTree };

// Keep in sync with FileTreeModel.MAX_TREE_DEPTH on the frontend
const MAX_TREE_DEPTH = 50;

/** Convert nested tree to flat array of paths (with depth limit for security) */
export function expandedTreeToPaths(tree: ExpandedTree, basePath: string = '', depth: number = 0): string[] {
	if (depth >= MAX_TREE_DEPTH) {
		return []; // Prevent stack overflow from malicious input
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
	for (const p of paths) {
		const parts = p.split('/').filter(Boolean);
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

/** Sort paths by depth (shallowest first), then alphabetically for stable ordering */
export function sortPathsByDepth(paths: string[]): string[] {
	return [...paths].sort((a, b) => {
		const depthA = a === '/' ? 0 : a.split('/').filter(Boolean).length;
		const depthB = b === '/' ? 0 : b.split('/').filter(Boolean).length;
		if (depthA !== depthB) return depthA - depthB;
		return a.localeCompare(b);
	});
}

/** Get display name for a path */
export function getDisplayName(path: string): string {
	return path === '/' ? 'Root' : path.split('/').pop() || path;
}
