/**
 * Convert Slate AST to markdown string
 *
 * This module builds an mdast tree directly from Slate nodes,
 * then uses remark-stringify to produce markdown.
 */

import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import type { Descendant } from 'slate';
import type { Root, RootContent, PhrasingContent, TableContent, RowContent } from 'mdast';
import type { CustomElement, CustomText, Comment, CommentWithRange } from '../types';
import { appendCommentsToMarkdown, calculateCommentRange } from './comments';

/**
 * Convert a Slate text node to mdast phrasing content.
 */
function textToMdast(node: CustomText): PhrasingContent {
	let result: PhrasingContent = { type: 'text', value: node.text };

	// Apply marks by wrapping in appropriate mdast nodes
	if (node.code) {
		result = { type: 'inlineCode', value: node.text };
	} else {
		if (node.bold) {
			result = { type: 'strong', children: [result] };
		}
		if (node.italic) {
			result = { type: 'emphasis', children: [result] };
		}
		if (node.strikethrough) {
			result = { type: 'delete', children: [result] };
		}
	}

	return result;
}

/**
 * Convert Slate children to mdast phrasing content (inline nodes).
 */
function childrenToPhrasingContent(children: Descendant[]): PhrasingContent[] {
	return children.flatMap((child): PhrasingContent[] => {
		if ('text' in child) {
			return [textToMdast(child as CustomText)];
		}
		// Handle inline elements like links
		const element = child as CustomElement;
		if (element.type === 'link') {
			return [{
				type: 'link',
				url: element.url,
				children: childrenToPhrasingContent(element.children),
			}];
		}
		// Other inline elements - just extract their text
		return childrenToPhrasingContent(element.children);
	});
}

/**
 * Convert a Slate element to mdast root content.
 */
function elementToMdast(element: CustomElement): RootContent | null {
	switch (element.type) {
		case 'paragraph':
			return {
				type: 'paragraph',
				children: childrenToPhrasingContent(element.children),
			};

		case 'heading':
			return {
				type: 'heading',
				depth: element.level as 1 | 2 | 3 | 4 | 5 | 6,
				children: childrenToPhrasingContent(element.children),
			};

		case 'blockquote':
			return {
				type: 'blockquote',
				children: element.children.map((child) => {
					if ('text' in child) {
						return {
							type: 'paragraph' as const,
							children: [textToMdast(child as CustomText)],
						};
					}
					return elementToMdast(child as CustomElement);
				}).filter((n): n is RootContent => n !== null),
			};

		case 'code-block': {
			// Get the text content from children
			const value = element.children
				.map((child) => ('text' in child ? (child as CustomText).text : ''))
				.join('');
			return {
				type: 'code',
				lang: element.language || null,
				value,
			};
		}

		case 'bulleted-list':
			return {
				type: 'list',
				ordered: false,
				spread: false,
				children: element.children
					.filter((child): child is CustomElement => !('text' in child) && (child as CustomElement).type === 'list-item')
					.map((item) => ({
						type: 'listItem' as const,
						spread: false,
						children: item.children.map((child) => {
							if ('text' in child) {
								return {
									type: 'paragraph' as const,
									children: [textToMdast(child as CustomText)],
								};
							}
							// Handle nested content in list items
							const nested = elementToMdast(child as CustomElement);
							return nested as RootContent;
						}).filter((n): n is RootContent => n !== null),
					})),
			};

		case 'numbered-list':
			return {
				type: 'list',
				ordered: true,
				start: 1,
				spread: false,
				children: element.children
					.filter((child): child is CustomElement => !('text' in child) && (child as CustomElement).type === 'list-item')
					.map((item) => ({
						type: 'listItem' as const,
						spread: false,
						children: item.children.map((child) => {
							if ('text' in child) {
								return {
									type: 'paragraph' as const,
									children: [textToMdast(child as CustomText)],
								};
							}
							const nested = elementToMdast(child as CustomElement);
							return nested as RootContent;
						}).filter((n): n is RootContent => n !== null),
					})),
			};

		case 'thematic-break':
			return { type: 'thematicBreak' };

		case 'table':
			return {
				type: 'table',
				children: element.children
					.filter((child): child is CustomElement => !('text' in child) && (child as CustomElement).type === 'table-row')
					.map((row): TableContent => ({
						type: 'tableRow',
						children: row.children
							.filter((cell): cell is CustomElement => !('text' in cell) && (cell as CustomElement).type === 'table-cell')
							.map((cell): RowContent => {
								// Table cells may have paragraph wrappers - unwrap them for serialization
								let cellContent = cell.children;
								if (cellContent.length === 1 && !('text' in cellContent[0]) && (cellContent[0] as CustomElement).type === 'paragraph') {
									cellContent = (cellContent[0] as CustomElement).children;
								}
								return {
									type: 'tableCell',
									children: childrenToPhrasingContent(cellContent),
								};
							}),
					})),
			};

		case 'link':
			// Links are inline, but if at top level, wrap in paragraph
			return {
				type: 'paragraph',
				children: [{
					type: 'link',
					url: element.url,
					children: childrenToPhrasingContent(element.children),
				}],
			};

		default:
			// For unknown types, try to convert as paragraph
			return {
				type: 'paragraph',
				children: childrenToPhrasingContent(element.children),
			};
	}
}

/**
 * Convert Slate AST to mdast Root.
 */
function slateToMdastTree(content: Descendant[]): Root {
	const children: RootContent[] = [];

	for (const node of content) {
		if ('text' in node) {
			// Top-level text nodes should be wrapped in a paragraph
			children.push({
				type: 'paragraph',
				children: [textToMdast(node as CustomText)],
			});
		} else {
			const mdastNode = elementToMdast(node as CustomElement);
			if (mdastNode) {
				children.push(mdastNode);
			}
		}
	}

	return { type: 'root', children };
}

/**
 * Track comment positions while extracting text from Slate tree.
 * Used to calculate line/column ranges for comment anchors.
 */
interface CommentAnchor {
	commentId: string;
	startOffset: number;
	endOffset: number;
	text: string;
}

/**
 * Extract plain text from Slate tree, tracking comment positions.
 * Returns the plain text and an array of comment anchors with their offsets.
 */
function extractTextWithComments(content: Descendant[]): {
	text: string;
	anchors: CommentAnchor[];
} {
	let text = '';
	const anchors: CommentAnchor[] = [];
	const activeComments = new Map<string, { startOffset: number; text: string }>();

	function walk(nodes: Descendant[]): void {
		for (const node of nodes) {
			if ('text' in node) {
				const textNode = node as CustomText;
				const startOffset = text.length;

				if (textNode.commentId) {
					// Track start of commented text
					if (!activeComments.has(textNode.commentId)) {
						activeComments.set(textNode.commentId, {
							startOffset,
							text: '',
						});
					}
					const anchor = activeComments.get(textNode.commentId)!;
					anchor.text += textNode.text;
				}

				text += textNode.text;
			} else if ('children' in node) {
				const element = node as CustomElement;

				// Add appropriate whitespace/newlines for block elements
				if (element.type === 'paragraph' || element.type === 'heading') {
					if (text.length > 0 && !text.endsWith('\n')) {
						text += '\n';
					}
				}

				walk(element.children);

				if (element.type === 'paragraph' || element.type === 'heading') {
					text += '\n';
				}
			}
		}
	}

	walk(content);

	// Finalize all anchors
	for (const [commentId, anchor] of activeComments) {
		anchors.push({
			commentId,
			startOffset: anchor.startOffset,
			endOffset: anchor.startOffset + anchor.text.length,
			text: anchor.text,
		});
	}

	return { text, anchors };
}

/**
 * Build CommentWithRange array from comments and markdown text.
 */
function buildCommentsWithRanges(
	comments: Comment[],
	markdown: string,
	content: Descendant[]
): CommentWithRange[] {
	// Extract comment positions from Slate content
	const { anchors } = extractTextWithComments(content);

	// Map comment IDs to anchors
	const anchorMap = new Map<string, CommentAnchor>();
	for (const anchor of anchors) {
		anchorMap.set(anchor.commentId, anchor);
	}

	// Build CommentWithRange for each comment
	return comments.map((comment): CommentWithRange => {
		const anchor = anchorMap.get(comment.id);

		if (anchor) {
			// Calculate range in markdown text
			// Note: This is approximate since markdown formatting affects positions
			// We use the anchor text for reliable matching when loading
			const range = calculateCommentRange(markdown, anchor.startOffset, anchor.endOffset);
			return {
				...comment,
				range,
				anchorText: anchor.text,
			};
		}

		// Comment without anchor (orphaned) - use placeholder range
		return {
			...comment,
			range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
			anchorText: '',
		};
	});
}

/**
 * Serialize Slate AST to markdown string.
 *
 * @param content - The Slate Descendant[] array
 * @param comments - Optional array of comments to include in footer
 * @returns Markdown string (with comments footer if comments provided)
 */
export function toMarkdown(content: Descendant[], comments?: Comment[]): string {
	if (!content || content.length === 0) {
		return '';
	}

	try {
		// Build mdast tree directly
		const mdast = slateToMdastTree(content);

		// Create processor for stringifying
		const processor = unified()
			.use(remarkGfm)
			.use(remarkStringify, {
				bullet: '-',
				emphasis: '_',
				strong: '*',
				fence: '`',
				fences: true,
				listItemIndent: 'one',
				rule: '-',
			});

		let markdown = processor.stringify(mdast);

		// Append comments footer if there are comments
		if (comments && comments.length > 0) {
			const commentsWithRanges = buildCommentsWithRanges(comments, markdown, content);
			markdown = appendCommentsToMarkdown(markdown, commentsWithRanges);
		}

		return markdown;
	} catch (error) {
		// Log enough context to diagnose serialization issues
		const nodeTypes = content.slice(0, 5).map(n => (n as { type?: string }).type || 'unknown');
		console.error('Failed to serialize to markdown:', error, { nodeTypes, nodeCount: content.length });
		return '';
	}
}
