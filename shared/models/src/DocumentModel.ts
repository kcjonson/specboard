import { Model } from './Model';
import { prop } from './prop';

/**
 * Slate document node type.
 * Using unknown[] to avoid coupling models package to slate.
 * The editor will cast this to Descendant[].
 */
export type SlateContent = unknown[];

/** Empty document content */
export const EMPTY_DOCUMENT: SlateContent = [
	{ type: 'paragraph', children: [{ text: '' }] }
];

/**
 * Deep clone a value using JSON serialization.
 */
function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

/**
 * Model for a markdown document.
 * Stores the Slate AST as its content property.
 *
 * This is the source of truth for the editor - Slate operates in
 * controlled mode with the model backing it.
 */
export class DocumentModel extends Model {
	/** Unique identifier for this document instance.
	 * Used as Slate key prop to force re-mount when loading different documents.
	 * Changes when a new document is loaded (not on every edit).
	 */
	@prop accessor documentId: string = crypto.randomUUID();

	/** Document title (derived from filename or first heading) */
	@prop accessor title: string = 'Untitled';

	/** The Slate AST representing document content */
	@prop accessor content: SlateContent = EMPTY_DOCUMENT;

	/** Last saved content snapshot for dirty comparison */
	@prop accessor savedContent: SlateContent = EMPTY_DOCUMENT;

	/** File path of the loaded document */
	@prop accessor filePath: string | null = null;

	/** Project ID for API context */
	@prop accessor projectId: string | null = null;

	/** Whether a save operation is in progress */
	@prop accessor saving: boolean = false;

	/** Whether the document has unsaved changes */
	@prop accessor dirty: boolean = false;

	/**
	 * Check if current content differs from saved content.
	 * Uses JSON comparison for deep equality.
	 */
	get isDirty(): boolean {
		return JSON.stringify(this.content) !== JSON.stringify(this.savedContent);
	}

	/**
	 * Load new document content. Generates a new documentId to force
	 * Slate editor to re-mount with fresh state.
	 *
	 * @param projectId - Project containing the document
	 * @param filePath - Path to the document file
	 * @param content - Slate AST content
	 * @param options - Optional settings
	 * @param options.dirty - Mark document as dirty (e.g., when restoring unsaved changes)
	 */
	loadDocument(
		projectId: string,
		filePath: string,
		content: SlateContent,
		options?: { dirty?: boolean }
	): void {
		this.documentId = crypto.randomUUID();
		this.projectId = projectId;
		this.filePath = filePath;
		this.title = filePath.split('/').pop() || 'Untitled';
		this.content = content;
		this.savedContent = options?.dirty ? EMPTY_DOCUMENT : deepClone(content);
		this.dirty = options?.dirty ?? false;
	}

	/**
	 * Mark the current content as saved.
	 * Updates savedContent snapshot and clears dirty flag.
	 */
	markSaved(): void {
		this.savedContent = deepClone(this.content);
		this.dirty = false;
	}

	/**
	 * Update the file path after a rename operation.
	 * Updates both filePath and title (derived from filename).
	 * Does not affect document content or dirty state.
	 *
	 * @param newPath - The new file path
	 */
	updateFilePath(newPath: string): void {
		this.filePath = newPath;
		this.title = newPath.split('/').pop() || 'Untitled';
	}

	/**
	 * Clear the document (reset to empty state).
	 */
	clear(): void {
		this.documentId = crypto.randomUUID();
		this.projectId = null;
		this.filePath = null;
		this.title = 'Untitled';
		this.content = EMPTY_DOCUMENT;
		this.savedContent = EMPTY_DOCUMENT;
		this.dirty = false;
	}
}
