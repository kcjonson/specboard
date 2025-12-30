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

	/** Whether the document has unsaved changes */
	@prop accessor dirty: boolean = false;

	/**
	 * Load new document content. Generates a new documentId to force
	 * Slate editor to re-mount with fresh state.
	 */
	loadDocument(title: string, content: SlateContent): void {
		// Set properties directly to avoid TypeScript inference issues with ModelData<this>
		this.documentId = crypto.randomUUID();
		this.title = title;
		this.content = content;
		this.dirty = false;
	}
}
