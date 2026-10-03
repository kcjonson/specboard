import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEM_STATUSES } from '@specboard/models';
import { NEEDS_PERSON_TOKEN, STATUS_GLYPHS, STATUS_TOKENS, glyphStatus } from './status-glyph';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('status glyph geometry', () => {
	it('fills each status by the amount the spec gives it', () => {
		expect(ITEM_STATUSES.map((status) => [status, STATUS_GLYPHS[status].filled])).toEqual([
			['ready', 0],
			['in_progress', 0.5],
			['blocked', 1],
			['in_review', 0.75],
			['done', 1],
		]);
	});

	it('gives every status a different shape', () => {
		const shapes = ITEM_STATUSES.map((status) => `${STATUS_GLYPHS[status].stroke}|${STATUS_GLYPHS[status].fill}`);
		expect(new Set(shapes).size).toBe(ITEM_STATUSES.length);
	});

	it('ends the pie at six o\'clock for half and nine o\'clock for three quarters', () => {
		expect(STATUS_GLYPHS.in_progress.fill).toContain('A4.25 4.25 0 0 1 8 12.25Z');
		expect(STATUS_GLYPHS.in_review.fill).toContain('A4.25 4.25 0 1 1 3.75 8Z');
	});

	it('names only tokens that tokens.css defines, in both themes where they differ', () => {
		const tokens = [...Object.values(STATUS_TOKENS), NEEDS_PERSON_TOKEN];
		for (const token of tokens) {
			expect(tokensCss).toContain(`${token}:`);
		}
		expect(tokensCss.match(/--color-blocked:/g)).toHaveLength(2);
		expect(tokensCss.match(/--color-done:/g)).toHaveLength(2);
	});
});

describe('glyphStatus', () => {
	it('shows blocked for the derived flag under any status', () => {
		expect(glyphStatus('ready', true)).toBe('blocked');
		expect(glyphStatus('in_progress', true)).toBe('blocked');
	});

	it('shows the status itself otherwise', () => {
		expect(glyphStatus('in_review', false)).toBe('in_review');
		expect(glyphStatus('done')).toBe('done');
	});
});
