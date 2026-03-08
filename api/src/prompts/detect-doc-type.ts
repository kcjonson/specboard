/**
 * Heuristic document type detection
 */

export type DocType = 'new-doc' | 'technical' | 'product';

/**
 * Classify a document based on its content.
 *
 * Heuristics:
 * - Empty, very short (<50 chars), or only a heading → 'new-doc'
 * - 2+ code fences or high density of backtick-wrapped terms → 'technical'
 * - Default → 'product'
 */
export function detectDocType(content?: string): DocType {
	if (!content || content.trim().length < 50) {
		return 'new-doc';
	}

	// Check if content is only a heading (e.g., "# My Title\n")
	const trimmed = content.trim();
	if (/^#{1,6}\s+.+$/.test(trimmed) && !trimmed.includes('\n')) {
		return 'new-doc';
	}

	// Count code fences (``` blocks)
	const codeFenceCount = (content.match(/^```/gm) || []).length;
	if (codeFenceCount >= 4) {
		// 4 fence markers = 2 complete code blocks
		return 'technical';
	}

	// Count inline code/backtick-wrapped terms
	const inlineCodeCount = (content.match(/`[^`]+`/g) || []).length;
	const wordCount = content.split(/\s+/).length;
	const inlineCodeDensity = wordCount > 0 ? inlineCodeCount / wordCount : 0;

	// High density of inline code suggests technical content
	if (inlineCodeDensity > 0.05 && inlineCodeCount >= 5) {
		return 'technical';
	}

	return 'product';
}
