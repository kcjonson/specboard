/**
 * Shared utilities for storage handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import path from 'path';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { getProject, type RepositoryConfig, isLocalRepository, isCloudRepository } from '@doc-platform/db';
import { LocalStorageProvider } from '../../services/storage/local-provider.ts';
import { CloudStorageProvider } from '../../services/storage/cloud-provider.ts';
import type { StorageProvider } from '../../services/storage/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	return session?.userId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage provider
// ─────────────────────────────────────────────────────────────────────────────

export async function getStorageProvider(
	projectId: string,
	userId: string
): Promise<StorageProvider | null> {
	const project = await getProject(projectId, userId);
	if (!project) return null;

	const repo = project.repository as RepositoryConfig | Record<string, never>;

	if (isLocalRepository(repo)) {
		return new LocalStorageProvider(repo.localPath);
	}

	if (isCloudRepository(repo)) {
		return new CloudStorageProvider(projectId, userId, {
			repositoryOwner: repo.remote.owner,
			repositoryName: repo.remote.repo,
			defaultBranch: repo.branch,
		});
	}

	return null; // storage_mode: 'none'
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
