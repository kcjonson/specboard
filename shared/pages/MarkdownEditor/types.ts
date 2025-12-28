import type { BaseEditor, Descendant } from 'slate';
import type { ReactEditor } from 'slate-react';
import type { HistoryEditor } from 'slate-history';

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
	| ThematicBreakElement;

// Text marks
export type FormattedText = {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
	strikethrough?: boolean;
};

export type CustomText = FormattedText;

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
