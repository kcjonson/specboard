/**
 * Specialized prompts for different document types
 *
 * Each doc type has its own .md file loaded at startup.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { DocType } from './detect-doc-type.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrompt(filename: string): string {
	return readFileSync(resolve(__dirname, filename), 'utf-8').trim();
}

const DOC_TYPE_PROMPTS: Record<DocType, string> = {
	'new-doc': loadPrompt('doc-type-new.md'),
	'technical': loadPrompt('doc-type-technical.md'),
	'product': loadPrompt('doc-type-product.md'),
};

export function getDocTypePrompt(docType: DocType): string {
	return DOC_TYPE_PROMPTS[docType];
}
