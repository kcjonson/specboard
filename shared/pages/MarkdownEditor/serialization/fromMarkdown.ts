/**
 * Convert markdown string to Slate AST
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkToSlate } from 'remark-slate-transformer';
import type { Descendant } from 'slate';
import type { CustomElement, CustomText, Comment, CommentWithRange } from '../types';
import { parseCommentsFromMarkdown, stripRanges } from './comments';

// Default empty document
const EMPTY_DOCUMENT: Descendant[] = [
	{ type: 'paragraph', children: [{ text: '' }] }
];

// Node types that are not yet supported - skip silently
const UNSUPPORTED_TYPES = new Set([
	'image',
	'imageReference',
	'footnote',
	'footnoteReference',
	'footnoteDefinition',
]);

/**
 * Map remark-slate node types to our custom types.
 * remark-slate uses slightly different names for some elements.
 * Returns null for unsupported types (will be filtered out).
 */
function normalizeNodeType(node: Record<string, unknown>): CustomElement | null {
	const type = node.type as string;

	// Skip unsupported types silently
	if (UNSUPPORTED_TYPES.has(type)) {
		return null;
	}

	// Get children - we'll set this on the result
	const children = node.children as Descendant[] | undefined;

	// Map remark-slate types to our custom types
	// IMPORTANT: Only include properties we need - don't spread node
	// as it contains remark-slate specific props that confuse Slate
	switch (type) {
		case 'p':
		case 'paragraph':
			return { type: 'paragraph', children: children || [] } as CustomElement;

		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6': {
			const level = parseInt(type.charAt(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
			return { type: 'heading', level, children: children || [] } as CustomElement;
		}

		case 'heading': {
			// remark-slate uses 'depth', we use 'level'
			const depth = (node.depth as number) || 1;
			return { type: 'heading', level: depth, children: children || [] } as CustomElement;
		}

		case 'blockquote':
			return { type: 'blockquote', children: children || [] } as CustomElement;

		case 'code':
		case 'code_block':
		case 'code-block': {
			const language = (node.lang as string) || undefined;
			return { type: 'code-block', language, children: children || [] } as CustomElement;
		}

		case 'ul':
		case 'unordered_list':
			return { type: 'bulleted-list', children: children || [] } as CustomElement;

		case 'ol':
		case 'ordered_list':
			return { type: 'numbered-list', children: children || [] } as CustomElement;

		case 'list': {
			// remark-slate outputs 'list' with 'ordered' property
			const ordered = node.ordered as boolean;
			return { type: ordered ? 'numbered-list' : 'bulleted-list', children: children || [] } as CustomElement;
		}

		case 'li':
		case 'list_item':
		case 'listItem':
			return { type: 'list-item', children: children || [] } as CustomElement;

		case 'lic':
			// List item content - unwrap and return children as paragraph
			return { type: 'paragraph', children: children || [] } as CustomElement;

		case 'a':
		case 'link': {
			const url = (node.url as string) || (node.href as string) || '';
			return { type: 'link', url, children: children || [] } as CustomElement;
		}

		case 'hr':
		case 'thematicBreak':
		case 'thematic-break':
			return { type: 'thematic-break', children: [{ text: '' }] } as CustomElement;

		case 'table':
			return { type: 'table', children: children || [] } as CustomElement;

		case 'tableRow':
		case 'tr':
			return { type: 'table-row', children: children || [] } as CustomElement;

		case 'tableCell':
		case 'td':
		case 'th': {
			const header = type === 'th' || (node.header as boolean) || false;
			return { type: 'table-cell', header, children: children || [] } as CustomElement;
		}

		default:
			// Unknown type - wrap in paragraph
			console.warn(`Unknown node type: ${type}, converting to paragraph`);
			return { type: 'paragraph', children: children || [] } as CustomElement;
	}
}

/**
 * Normalize text marks from remark-slate format to our format.
 * remark-slate may use different property names.
 */
function normalizeMarks(node: Record<string, unknown>): Record<string, unknown> {
	const result = { ...node };

	// Map strong -> bold
	if (result.strong) {
		result.bold = true;
		delete result.strong;
	}

	// Map emphasis -> italic
	if (result.emphasis) {
		result.italic = true;
		delete result.emphasis;
	}

	// Map inlineCode -> code
	if (result.inlineCode) {
		result.code = true;
		delete result.inlineCode;
	}

	// Map delete -> strikethrough
	if (result.delete) {
		result.strikethrough = true;
		delete result.delete;
	}

	return result;
}

/**
 * Check if all children are text nodes (no block elements).
 */
function hasOnlyTextChildren(children: unknown[]): boolean {
	return children.every(child => {
		const c = child as Record<string, unknown>;
		return typeof c.text === 'string';
	});
}

/**
 * Recursively normalize a Slate tree from remark-slate output.
 */
function normalizeTree(nodes: unknown[]): Descendant[] {
	const results: Descendant[] = [];

	for (const node of nodes) {
		const n = node as Record<string, unknown>;

		// Text node
		if (typeof n.text === 'string') {
			results.push(normalizeMarks(n) as Descendant);
			continue;
		}

		// Element node - normalize type and recurse into children
		const normalized = normalizeNodeType(n);

		// Skip unsupported types (returned as null)
		if (normalized === null) {
			continue;
		}

		if (Array.isArray(normalized.children)) {
			// Table cells need their text content wrapped in paragraphs
			// because Slate expects block elements inside cells for proper selection
			if (normalized.type === 'table-cell' && hasOnlyTextChildren(normalized.children)) {
				normalized.children = [{
					type: 'paragraph',
					children: normalizeTree(normalized.children),
				}] as Descendant[];
			} else {
				normalized.children = normalizeTree(normalized.children);
			}
		}

		results.push(normalized as Descendant);
	}

	return results;
}

/**
 * Extract all text content from a Slate tree.
 */
function extractText(nodes: Descendant[]): string {
	let text = '';
	for (const node of nodes) {
		if ('text' in node) {
			text += (node as CustomText).text;
		} else if ('children' in node) {
			text += extractText((node as CustomElement).children);
		}
	}
	return text;
}

/**
 * Apply comment marks to the Slate tree by matching anchor text.
 * This mutates the tree in place.
 */
function applyCommentMarks(
	nodes: Descendant[],
	comments: CommentWithRange[]
): void {
	if (comments.length === 0) return;

	// Build a map of anchor text -> comment ID for quick lookup
	const anchorMap = new Map<string, string>();
	for (const comment of comments) {
		if (comment.anchorText) {
			anchorMap.set(comment.anchorText, comment.id);
		}
	}

	// Walk the tree and look for text that matches comment anchors
	function walkAndMark(nodes: Descendant[]): void {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node) continue;

			if ('text' in node) {
				const textNode = node as CustomText;
				// Check if this text node's content matches any anchor
				for (const [anchorText, cId] of anchorMap) {
					if (textNode.text === anchorText) {
						// Exact match - apply the comment mark
						textNode.commentId = cId;
						anchorMap.delete(anchorText); // Each comment only matches once
						break;
					} else if (textNode.text.includes(anchorText)) {
						// Partial match - need to split the text node
						const idx = textNode.text.indexOf(anchorText);
						const before = textNode.text.slice(0, idx);
						const match = anchorText;
						const after = textNode.text.slice(idx + match.length);

						// Build new nodes
						const newNodes: CustomText[] = [];
						if (before) {
							newNodes.push({ ...textNode, text: before, commentId: undefined });
						}
						newNodes.push({ ...textNode, text: match, commentId: cId });
						if (after) {
							newNodes.push({ ...textNode, text: after, commentId: undefined });
						}

						// Replace the current node with the new nodes
						nodes.splice(i, 1, ...newNodes);
						anchorMap.delete(anchorText);
						i += newNodes.length - 1; // Adjust index
						break;
					}
				}
			} else if ('children' in node) {
				// Check if concatenated children text matches any anchor
				const element = node as CustomElement;
				const fullText = extractText(element.children);

				for (const [anchorText] of anchorMap) {
					if (fullText.includes(anchorText)) {
						// The anchor text spans across this element's children
						// Recurse into children to apply marks
						walkAndMark(element.children);
						break;
					}
				}

				// Always recurse to handle nested comments
				walkAndMark(element.children);
			}
		}
	}

	walkAndMark(nodes);
}

/** Result of parsing markdown with comments */
export interface ParseResult {
	content: Descendant[];
	comments: Comment[];
}

/**
 * Parse markdown string to Slate AST, extracting comments from footer.
 *
 * @param markdown - The markdown string to parse (may include comments footer)
 * @returns Object with Slate content and comments array
 */
export function fromMarkdown(markdown: string): ParseResult {
	if (!markdown || markdown.trim() === '') {
		return { content: EMPTY_DOCUMENT, comments: [] };
	}

	try {
		// Parse comments from footer first
		const { content: contentMarkdown, comments: commentsWithRanges } =
			parseCommentsFromMarkdown(markdown);

		const processor = unified()
			.use(remarkParse)
			.use(remarkGfm)
			.use(remarkToSlate);

		const result = processor.processSync(contentMarkdown);
		const slateNodes = result.result as unknown[];

		// Normalize the output to match our custom types
		const normalized = normalizeTree(slateNodes);

		// Ensure we have at least one node
		if (normalized.length === 0) {
			return { content: EMPTY_DOCUMENT, comments: stripRanges(commentsWithRanges) };
		}

		// Apply comment marks to the Slate tree
		applyCommentMarks(normalized, commentsWithRanges);

		// Strip ranges from comments for UI use
		const comments = stripRanges(commentsWithRanges);

		return { content: normalized, comments };
	} catch (error) {
		// Log enough context to diagnose parsing issues
		const preview = markdown.length > 200 ? markdown.slice(0, 200) + '...' : markdown;
		console.error('Failed to parse markdown:', error, { preview });
		return { content: EMPTY_DOCUMENT, comments: [] };
	}
}
