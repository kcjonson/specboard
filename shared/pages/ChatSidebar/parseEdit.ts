/**
 * Utilities for parsing and applying SEARCH/REPLACE edit blocks from AI responses
 */

export interface EditBlock {
	search: string;
	replace: string;
	matched: boolean;
	matchIndex?: number;
	/** The actual text found in the document (may differ from search due to whitespace) */
	matchedText?: string;
}

export interface ParsedEdits {
	blocks: EditBlock[];
	textSegments: TextSegment[];
	stats: EditStats;
}

export interface TextSegment {
	type: 'text' | 'edit';
	content: string;
	editIndex?: number;
}

export interface EditStats {
	totalBlocks: number;
	matchedBlocks: number;
	insertions: number;
	deletions: number;
}

const EDIT_BLOCK_PATTERN = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

/**
 * Parse SEARCH/REPLACE blocks from AI response content
 */
export function parseEditBlocks(content: string): EditBlock[] {
	const blocks: EditBlock[] = [];
	const regex = new RegExp(EDIT_BLOCK_PATTERN.source, 'g');
	let match;

	while ((match = regex.exec(content)) !== null) {
		blocks.push({
			search: match[1],
			replace: match[2],
			matched: false,
		});
	}

	return blocks;
}

/**
 * Split content into text segments and edit blocks for rendering
 */
export function parseContentSegments(content: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const regex = new RegExp(EDIT_BLOCK_PATTERN.source, 'g');
	let lastIndex = 0;
	let editIndex = 0;
	let match;

	while ((match = regex.exec(content)) !== null) {
		// Add text before this edit block
		if (match.index > lastIndex) {
			const text = content.slice(lastIndex, match.index).trim();
			if (text) {
				segments.push({ type: 'text', content: text });
			}
		}

		// Add the edit block
		segments.push({
			type: 'edit',
			content: match[0],
			editIndex: editIndex++,
		});

		lastIndex = match.index + match[0].length;
	}

	// Add remaining text after last edit block
	if (lastIndex < content.length) {
		const text = content.slice(lastIndex).trim();
		if (text) {
			segments.push({ type: 'text', content: text });
		}
	}

	return segments;
}

/**
 * Try to match edit blocks against the document content
 */
export function matchBlocksToDocument(
	blocks: EditBlock[],
	document: string
): EditBlock[] {
	return blocks.map(block => {
		// Try exact match first
		const exactIndex = document.indexOf(block.search);
		if (exactIndex !== -1) {
			return {
				...block,
				matched: true,
				matchIndex: exactIndex,
				matchedText: block.search,
			};
		}

		// Try whitespace-normalized match
		const normalizedResult = findNormalizedMatch(document, block.search);
		if (normalizedResult) {
			return {
				...block,
				matched: true,
				matchIndex: normalizedResult.index,
				matchedText: normalizedResult.text,
			};
		}

		return { ...block, matched: false };
	});
}

interface NormalizedMatchResult {
	index: number;
	text: string;
}

/**
 * Find a match with whitespace normalization (trimmed lines)
 * Returns the actual text that was matched so we can replace it correctly
 */
function findNormalizedMatch(document: string, search: string): NormalizedMatchResult | null {
	const searchLines = search.split('\n').map(l => l.trimEnd());
	const docLines = document.split('\n');
	const docLinesTrimmed = docLines.map(l => l.trimEnd());

	for (let i = 0; i <= docLinesTrimmed.length - searchLines.length; i++) {
		let matches = true;
		for (let j = 0; j < searchLines.length; j++) {
			if (docLinesTrimmed[i + j] !== searchLines[j]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			// Calculate character position
			let pos = 0;
			for (let k = 0; k < i; k++) {
				pos += docLines[k].length + 1; // +1 for newline
			}
			// Get the actual text from the document (including original whitespace)
			const matchedLines = docLines.slice(i, i + searchLines.length);
			const matchedText = matchedLines.join('\n');
			return { index: pos, text: matchedText };
		}
	}

	return null;
}

/**
 * Compute diff statistics for the edit blocks
 */
export function computeEditStats(blocks: EditBlock[]): EditStats {
	let insertions = 0;
	let deletions = 0;
	let matchedBlocks = 0;

	for (const block of blocks) {
		if (block.matched) {
			matchedBlocks++;
		}

		const searchLines = block.search.split('\n').length;
		const replaceLines = block.replace.split('\n').length;

		if (replaceLines > searchLines) {
			insertions += replaceLines - searchLines;
		} else if (searchLines > replaceLines) {
			deletions += searchLines - replaceLines;
		}
	}

	return {
		totalBlocks: blocks.length,
		matchedBlocks,
		insertions,
		deletions,
	};
}

/**
 * Apply matched edit blocks to the document
 * Returns the new document content
 */
export function applyEdits(document: string, blocks: EditBlock[]): string {
	let result = document;

	// Sort by match index descending to apply from end to start
	// This preserves indices for earlier matches
	const sortedBlocks = [...blocks]
		.filter(b => b.matched && b.matchIndex !== undefined && b.matchedText !== undefined)
		.sort((a, b) => (b.matchIndex ?? 0) - (a.matchIndex ?? 0));

	for (const block of sortedBlocks) {
		// Use the actual matched text (which accounts for whitespace differences)
		const textToReplace = block.matchedText!;
		const index = result.indexOf(textToReplace);
		if (index !== -1) {
			result = result.slice(0, index) + block.replace + result.slice(index + textToReplace.length);
		}
	}

	return result;
}

/**
 * Check if content contains any SEARCH/REPLACE blocks
 */
export function hasEditBlocks(content: string): boolean {
	return EDIT_BLOCK_PATTERN.test(content);
}

/**
 * Parse edits from AI response and match against document
 */
export function parseAndMatchEdits(
	content: string,
	document: string
): ParsedEdits {
	const blocks = parseEditBlocks(content);
	const matchedBlocks = matchBlocksToDocument(blocks, document);
	const textSegments = parseContentSegments(content);
	const stats = computeEditStats(matchedBlocks);

	return {
		blocks: matchedBlocks,
		textSegments,
		stats,
	};
}
