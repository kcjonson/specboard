/**
 * SEARCH/REPLACE edit format instructions
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const EDIT_FORMAT_PROMPT = readFileSync(resolve(__dirname, 'edit-format.md'), 'utf-8').trim();
