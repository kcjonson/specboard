import type { BaseEditor, Descendant } from 'slate';
import type { ReactEditor } from 'slate-react';
import type { HistoryEditor } from 'slate-history';

// Simple element types for rich text descriptions
export type ParagraphElement = {
	type: 'paragraph';
	children: Descendant[];
};

// Union of all element types (just paragraph for descriptions)
export type CustomElement = ParagraphElement;

// Text marks for inline formatting
export type FormattedText = {
	text: string;
	bold?: true;
	italic?: true;
	code?: true;
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
export type MarkType = 'bold' | 'italic' | 'code';
