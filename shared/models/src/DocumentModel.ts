import { Model } from './Model';
import { prop } from './prop';

/**
 * Slate document node type.
 * Using unknown[] to avoid coupling models package to slate.
 * The editor will cast this to Descendant[].
 */
export type SlateContent = unknown[];

/**
 * Comment type for document comments.
 * Matches the Comment interface from MarkdownEditor.
 */
export interface DocumentComment {
	id: string;
	text: string;
	author: string;
	authorEmail: string;
	timestamp: string;
	resolved: boolean;
	replies: DocumentComment[];
}

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

	/** Comments attached to the document */
	@prop accessor comments: DocumentComment[] = [];

	/** Last saved comments snapshot for dirty comparison */
	@prop accessor savedComments: DocumentComment[] = [];

	/**
	 * Check if current content differs from saved content.
	 * Uses JSON comparison for deep equality.
	 */
	get isDirty(): boolean {
		return JSON.stringify(this.content) !== JSON.stringify(this.savedContent) ||
			JSON.stringify(this.comments) !== JSON.stringify(this.savedComments);
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
	 * @param options.comments - Comments attached to the document
	 */
	loadDocument(
		projectId: string,
		filePath: string,
		content: SlateContent,
		options?: { dirty?: boolean; comments?: DocumentComment[] }
	): void {
		this.documentId = crypto.randomUUID();
		this.projectId = projectId;
		this.filePath = filePath;
		this.title = filePath.split('/').pop() || 'Untitled';
		this.content = content;
		this.savedContent = options?.dirty ? EMPTY_DOCUMENT : deepClone(content);
		this.comments = options?.comments ?? [];
		this.savedComments = options?.dirty ? [] : deepClone(this.comments);
		this.dirty = options?.dirty ?? false;
	}

	/**
	 * Mark the current content as saved.
	 * Updates savedContent snapshot and clears dirty flag.
	 */
	markSaved(): void {
		this.savedContent = deepClone(this.content);
		this.savedComments = deepClone(this.comments);
		this.dirty = false;
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
		this.comments = [];
		this.savedComments = [];
		this.dirty = false;
	}

	/**
	 * Add a new comment to the document.
	 */
	addComment(comment: DocumentComment): void {
		this.comments = [...this.comments, comment];
		this.dirty = true;
	}

	/**
	 * Update an existing comment.
	 * @returns true if the comment was found and updated, false otherwise
	 */
	updateComment(commentId: string, updates: Partial<DocumentComment>): boolean {
		const index = this.comments.findIndex(c => c.id === commentId);
		if (index === -1) {
			return false;
		}
		this.comments = this.comments.map(c =>
			c.id === commentId ? { ...c, ...updates } : c
		);
		this.dirty = true;
		return true;
	}

	/**
	 * Add a reply to a comment.
	 * @returns true if the comment was found and reply added, false otherwise
	 */
	addReply(commentId: string, reply: DocumentComment): boolean {
		const index = this.comments.findIndex(c => c.id === commentId);
		if (index === -1) {
			return false;
		}
		this.comments = this.comments.map(c =>
			c.id === commentId
				? { ...c, replies: [...c.replies, reply] }
				: c
		);
		this.dirty = true;
		return true;
	}

	/**
	 * Toggle the resolved status of a comment.
	 * @returns true if the comment was found and toggled, false otherwise
	 */
	toggleResolved(commentId: string): boolean {
		const index = this.comments.findIndex(c => c.id === commentId);
		if (index === -1) {
			return false;
		}
		this.comments = this.comments.map(c =>
			c.id === commentId ? { ...c, resolved: !c.resolved } : c
		);
		this.dirty = true;
		return true;
	}
}
