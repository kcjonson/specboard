import type { Descendant } from 'slate';
import type { Comment } from './types';

/**
 * Mock document for in-memory editing.
 * This will be replaced with actual file loading/saving later.
 */
export const mockDocument: Descendant[] = [
	{
		type: 'heading',
		level: 1,
		children: [{ text: 'Welcome to the Editor' }],
	},
	{
		type: 'paragraph',
		children: [
			{ text: 'This is a ' },
			{ text: 'rich text', bold: true, commentId: 'comment-1' },
			{ text: ' editor built with ' },
			{ text: 'Slate.js', italic: true },
			{ text: ' and ' },
			{ text: 'Preact', code: true },
			{ text: '.' },
		],
	},
	{
		type: 'heading',
		level: 2,
		children: [{ text: 'Features' }],
	},
	{
		type: 'paragraph',
		children: [
			{ text: 'The editor supports:' },
		],
	},
	{
		type: 'bulleted-list',
		children: [
			{
				type: 'list-item',
				children: [
					{ text: 'Bold', bold: true },
					{ text: ', ' },
					{ text: 'italic', italic: true },
					{ text: ', and ' },
					{ text: 'inline code', code: true },
					{ text: ' formatting' },
				],
			},
			{
				type: 'list-item',
				children: [{ text: 'Headings (H1-H6)' }],
			},
			{
				type: 'list-item',
				children: [{ text: 'Block quotes' }],
			},
			{
				type: 'list-item',
				children: [{ text: 'Bulleted and numbered lists' }],
			},
			{
				type: 'list-item',
				children: [{ text: 'Code blocks' }],
			},
		],
	},
	{
		type: 'heading',
		level: 2,
		children: [{ text: 'Code Example' }],
	},
	{
		type: 'code-block',
		language: 'typescript',
		children: [
			{ text: 'function greet(name: string): string {\n  return `Hello, ${name}!`;\n}' },
		],
	},
	{
		type: 'heading',
		level: 2,
		children: [{ text: 'Quote' }],
	},
	{
		type: 'blockquote',
		children: [
			{
				type: 'paragraph',
				children: [
					{ text: 'The best way to predict the future is to ', commentId: 'comment-2' },
					{ text: 'invent it.' },
				],
			},
		],
	},
	{
		type: 'paragraph',
		children: [
			{ text: '— Alan Kay' },
		],
	},
	{
		type: 'thematic-break',
		children: [{ text: '' }],
	},
	{
		type: 'paragraph',
		children: [
			{ text: 'Start editing this document to try out the editor. Use keyboard shortcuts like ' },
			{ text: 'Ctrl+B', code: true },
			{ text: ' for bold and ' },
			{ text: 'Ctrl+I', code: true },
			{ text: ' for italic.' },
		],
	},
];

/**
 * Mock comments for testing the inline comments UI.
 */
export const mockComments: Comment[] = [
	{
		id: 'comment-1',
		text: 'Consider making this more descriptive. Maybe "formatted rich text" would be better?',
		author: 'Jane Doe',
		authorEmail: 'jane@example.com',
		timestamp: '2025-12-28T10:30:00Z',
		resolved: false,
		replies: [
			{
				id: 'reply-1',
				text: 'Good point! I\'ll update this.',
				author: 'John Smith',
				authorEmail: 'john@example.com',
				timestamp: '2025-12-28T11:15:00Z',
				resolved: false,
				replies: [],
			},
		],
	},
	{
		id: 'comment-2',
		text: 'Great quote! Should we add the attribution year (1971)?',
		author: 'Alex Johnson',
		authorEmail: 'alex@example.com',
		timestamp: '2025-12-28T09:45:00Z',
		resolved: false,
		replies: [],
	},
];
