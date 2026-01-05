// Re-export types from MarkdownEditor to avoid conflicting Slate module augmentations.
// The MarkdownEditor types are a superset of what RichTextEditor needs.
export type { MarkType, CustomText } from '../../pages/MarkdownEditor/types';

// Local type for the subset of marks we use (for documentation, not runtime)
export type RichTextMarkType = 'bold' | 'italic' | 'code';
