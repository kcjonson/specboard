/**
 * localStorage persistence for DocumentModel crash recovery.
 *
 * Persists document content to localStorage so uncommitted changes
 * are not lost if the browser crashes or window closes.
 */

import type { SlateContent, DocumentComment } from './DocumentModel';

const STORAGE_PREFIX = 'doc.';

/**
 * Get storage interface, handling SSR and restricted environments.
 */
function getStorage(): typeof globalThis.localStorage | null {
	try {
		const storage = globalThis.localStorage;
		return storage ?? null;
	} catch {
		// localStorage may throw in restricted contexts (private browsing, etc.)
		return null;
	}
}

/**
 * Generate storage key for a document.
 */
function getStorageKey(projectSlug: string, filePath: string): string {
	return `${STORAGE_PREFIX}${projectSlug}:${filePath}`;
}

/**
 * Persisted document data structure.
 */
interface PersistedDocument {
	content: SlateContent;
	comments?: DocumentComment[];
	savedAt: number;
}

/**
 * Save document content to localStorage for crash recovery.
 *
 * @param projectSlug - Project slug
 * @param filePath - File path within the project
 * @param content - Slate AST content to persist
 * @param comments - Optional comments to persist alongside content
 */
export function saveToLocalStorage(
	projectSlug: string,
	filePath: string,
	content: SlateContent,
	comments?: DocumentComment[]
): void {
	const storage = getStorage();
	if (!storage) return;

	try {
		const key = getStorageKey(projectSlug, filePath);
		const data: PersistedDocument = {
			content,
			comments,
			savedAt: Date.now(),
		};
		storage.setItem(key, JSON.stringify(data));
	} catch (err) {
		// Log storage errors (quota exceeded, etc.) for debugging
		console.warn('Failed to save document to localStorage:', err);
	}
}

/**
 * Result of loading persisted document data.
 */
export interface LoadedPersistedDocument {
	content: SlateContent;
	comments?: DocumentComment[];
}

/**
 * Load persisted document content from localStorage.
 *
 * @param projectSlug - Project slug
 * @param filePath - File path within the project
 * @returns Persisted content and comments, or null if not found
 */
export function loadFromLocalStorage(
	projectSlug: string,
	filePath: string
): LoadedPersistedDocument | null {
	const storage = getStorage();
	if (!storage) return null;

	try {
		const key = getStorageKey(projectSlug, filePath);
		const stored = storage.getItem(key);
		if (!stored) return null;

		const data = JSON.parse(stored) as PersistedDocument;
		return {
			content: data.content,
			comments: data.comments,
		};
	} catch (err) {
		console.warn('Failed to load document from localStorage:', err);
		return null;
	}
}

/**
 * Check if there's persisted content for a document.
 *
 * @param projectSlug - Project slug
 * @param filePath - File path within the project
 * @returns True if persisted content exists
 */
export function hasPersistedContent(
	projectSlug: string,
	filePath: string
): boolean {
	const storage = getStorage();
	if (!storage) return false;

	const key = getStorageKey(projectSlug, filePath);
	return storage.getItem(key) !== null;
}

/**
 * Clear persisted document content from localStorage.
 * Call this after successfully saving to the server.
 *
 * @param projectSlug - Project slug
 * @param filePath - File path within the project
 */
export function clearLocalStorage(
	projectSlug: string,
	filePath: string
): void {
	const storage = getStorage();
	if (!storage) return;

	try {
		const key = getStorageKey(projectSlug, filePath);
		storage.removeItem(key);
	} catch (err) {
		console.warn('Failed to clear document from localStorage:', err);
	}
}

/**
 * Get the timestamp of when the document was last persisted.
 *
 * @param projectSlug - Project slug
 * @param filePath - File path within the project
 * @returns Timestamp in milliseconds, or null if not found
 */
export function getPersistedTimestamp(
	projectSlug: string,
	filePath: string
): number | null {
	const storage = getStorage();
	if (!storage) return null;

	try {
		const key = getStorageKey(projectSlug, filePath);
		const stored = storage.getItem(key);
		if (!stored) return null;

		const data = JSON.parse(stored) as PersistedDocument;
		return data.savedAt;
	} catch {
		return null;
	}
}
