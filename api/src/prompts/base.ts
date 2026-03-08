/**
 * Core writing assistant identity prompt
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BASE_PROMPT = readFileSync(resolve(__dirname, 'base.md'), 'utf-8').trim();
