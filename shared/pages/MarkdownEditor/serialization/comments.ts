/**
 * Comment serialization utilities
 *
 * Handles parsing and serializing comments from/to markdown footer.
 * Comments are stored as HTML comments containing JSON at the end of the file.
 */

import type { CommentWithRange, Comment } from '../types';

// Regex to match the comments footer
// Matches <!-- COMMENTS: followed by JSON array and closing -->
const COMMENTS_REGEX = /\n?<!-- COMMENTS:\n([\s\S]*?)\n-->\s*$/;

/**
 * Parse comments from markdown footer.
 * Returns the comments array and the markdown without the footer.
 */
export function parseCommentsFromMarkdown(markdown: string): {
	content: string;
	comments: CommentWithRange[];
} {
	const match = markdown.match(COMMENTS_REGEX);

	if (!match) {
		return { content: markdown, comments: [] };
	}

	const jsonStr = match[1];
	const content = markdown.slice(0, match.index);

	try {
		const comments = JSON.parse(jsonStr) as CommentWithRange[];
		// Validate that it's an array
		if (!Array.isArray(comments)) {
			console.warn('Comments footer is not an array, ignoring');
			return { content, comments: [] };
		}
		return { content, comments };
	} catch (err) {
		console.warn('Failed to parse comments JSON:', err);
		return { content, comments: [] };
	}
}

/**
 * Append comments footer to markdown content.
 * Only adds footer if there are comments.
 */
export function appendCommentsToMarkdown(
	markdown: string,
	comments: CommentWithRange[]
): string {
	if (comments.length === 0) {
		return markdown;
	}

	// Pretty-print the JSON for readability
	const json = JSON.stringify(comments, null, 2);

	// Ensure markdown ends with newline before adding footer
	const base = markdown.endsWith('\n') ? markdown : markdown + '\n';

	return `${base}\n<!-- COMMENTS:\n${json}\n-->`;
}

/**
 * Strip the range property from comments for use in the UI.
 * The UI doesn't need the range - it uses Slate marks instead.
 */
export function stripRanges(comments: CommentWithRange[]): Comment[] {
	return comments.map(({ range: _range, ...comment }) => comment);
}

/**
 * Calculate line and column from a character offset in text.
 * Lines and columns are 1-indexed.
 */
export function offsetToLineColumn(
	text: string,
	offset: number
): { line: number; column: number } {
	const lines = text.slice(0, offset).split('\n');
	const line = lines.length;
	const column = (lines[lines.length - 1]?.length ?? 0) + 1;
	return { line, column };
}

/**
 * Calculate character offset from line and column.
 * Lines and columns are 1-indexed.
 */
export function lineColumnToOffset(
	text: string,
	line: number,
	column: number
): number {
	const lines = text.split('\n');

	// Clamp line to valid range (1..number of lines)
	const maxLine = Math.max(lines.length, 1);
	const safeLine = Math.min(Math.max(line, 1), maxLine);

	// Calculate offset to start of target line
	let offset = 0;
	for (let i = 0; i < safeLine - 1 && i < lines.length; i++) {
		offset += (lines[i]?.length ?? 0) + 1; // +1 for newline
	}

	// Clamp column to valid range for the target line
	const lineIndex = safeLine - 1;
	const lineLength = lines[lineIndex]?.length ?? 0;
	const safeColumn = Math.min(Math.max(column, 1), lineLength + 1);

	offset += safeColumn - 1;

	// Ensure offset doesn't exceed text length
	return Math.min(offset, text.length);
}

/**
 * Find comment ranges in markdown text based on where commentId marks
 * would be applied. This is used when saving - we need to convert
 * Slate positions back to line/column ranges.
 *
 * @param markdown - The markdown text (without comments footer)
 * @param commentId - The comment ID to find
 * @param startOffset - Character offset where the comment starts
 * @param endOffset - Character offset where the comment ends
 */
export function calculateCommentRange(
	markdown: string,
	startOffset: number,
	endOffset: number
): CommentWithRange['range'] {
	const start = offsetToLineColumn(markdown, startOffset);
	const end = offsetToLineColumn(markdown, endOffset);

	return {
		startLine: start.line,
		startColumn: start.column,
		endLine: end.line,
		endColumn: end.column,
	};
}
