import type { BaseEditor, Descendant } from 'slate';
import type { ReactEditor } from 'slate-react';
import type { HistoryEditor } from 'slate-history';
import type { DocumentComment } from '@specboard/models';

// Custom element types
export type ParagraphElement = {
	type: 'paragraph';
	children: Descendant[];
};

export type HeadingElement = {
	type: 'heading';
	level: 1 | 2 | 3 | 4 | 5 | 6;
	children: Descendant[];
};

export type BlockquoteElement = {
	type: 'blockquote';
	children: Descendant[];
};

export type CodeBlockElement = {
	type: 'code-block';
	language?: string;
	children: Descendant[];
};

export type BulletedListElement = {
	type: 'bulleted-list';
	children: Descendant[];
};

export type NumberedListElement = {
	type: 'numbered-list';
	children: Descendant[];
};

export type ListItemElement = {
	type: 'list-item';
	children: Descendant[];
};

export type LinkElement = {
	type: 'link';
	url: string;
	children: Descendant[];
};

export type ThematicBreakElement = {
	type: 'thematic-break';
	children: Descendant[];
};

export type TableElement = {
	type: 'table';
	children: Descendant[];
};

export type TableRowElement = {
	type: 'table-row';
	children: Descendant[];
};

export type TableCellElement = {
	type: 'table-cell';
	header?: boolean;
	children: Descendant[];
};

// Union of all element types
export type CustomElement =
	| ParagraphElement
	| HeadingElement
	| BlockquoteElement
	| CodeBlockElement
	| BulletedListElement
	| NumberedListElement
	| ListItemElement
	| LinkElement
	| ThematicBreakElement
	| TableElement
	| TableRowElement
	| TableCellElement;

// Text marks - using `true` (not `boolean`) per Slate best practices for better type narrowing
export type FormattedText = {
	text: string;
	bold?: true;
	italic?: true;
	code?: true;
	strikethrough?: true;
	commentId?: string; // Links text to a comment
};

export type CustomText = FormattedText;

// Comment range in markdown (line/column based)
export interface CommentRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

// Comment data structure - use the shared type from models
// Alias for backwards compatibility with existing code
export type Comment = DocumentComment;

// Comment with range for storage in markdown footer
export interface CommentWithRange extends Comment {
	range: CommentRange;
	anchorText: string; // The text that was commented (for matching when loading)
}

// Editor type combining all plugins
export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor;

// Extend Slate's types
declare module 'slate' {
	interface CustomTypes {
		Editor: CustomEditor;
		Element: CustomElement;
		Text: CustomText;
	}
}

// Mark types as union
export type MarkType = 'bold' | 'italic' | 'code' | 'strikethrough';

// Block types as union
export type BlockType = CustomElement['type'];
