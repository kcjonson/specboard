import type { Descendant } from 'slate';

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
			{ text: 'rich text', bold: true },
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
					{ text: 'The best way to predict the future is to invent it.' },
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
