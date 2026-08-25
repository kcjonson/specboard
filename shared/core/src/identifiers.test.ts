/**
 * Identifier tests — the derivation rules that decide what a project's URL looks
 * like, and the parsing that turns an address bar back into a lookup.
 */

import { describe, it, expect } from 'vitest';
import {
	slugifyProjectName,
	deriveProjectKey,
	isValidProjectSlug,
	isValidProjectKey,
	formatItemKey,
	parseItemKey,
	itemNumberInProject,
	withSuffix,
	MAX_PROJECT_SLUG_LENGTH,
	MAX_PROJECT_KEY_LENGTH,
} from './identifiers.ts';

describe('slugifyProjectName', () => {
	it('lowercases and hyphenates', () => {
		expect(slugifyProjectName('Dual Deck Builder')).toBe('dual-deck-builder');
	});

	it('collapses runs of punctuation into one hyphen', () => {
		expect(slugifyProjectName('Foo -- & ++ Bar')).toBe('foo-bar');
	});

	it('trims leading and trailing separators', () => {
		expect(slugifyProjectName('  !!Specboard!!  ')).toBe('specboard');
	});

	it('falls back when nothing usable remains', () => {
		expect(slugifyProjectName('!!!')).toBe('project');
		expect(slugifyProjectName('')).toBe('project');
	});

	it('caps length without leaving a trailing hyphen', () => {
		const slug = slugifyProjectName(`${'a'.repeat(MAX_PROJECT_SLUG_LENGTH)} tail`);
		expect(slug.length).toBeLessThanOrEqual(MAX_PROJECT_SLUG_LENGTH);
		expect(slug.endsWith('-')).toBe(false);
	});

	it('always produces something the validator accepts', () => {
		for (const name of ['Specboard', '!!!', '   ', 'A', '123', 'Ünïcödé nåme', 'a'.repeat(200)]) {
			expect(isValidProjectSlug(slugifyProjectName(name))).toBe(true);
		}
	});
});

describe('deriveProjectKey', () => {
	it('uses initials for multi-word names', () => {
		expect(deriveProjectKey('Dual Deck Builder')).toBe('DDB');
	});

	it('caps initials at five words', () => {
		expect(deriveProjectKey('a b c d e f g')).toBe('ABCDE');
	});

	it('uses the first three characters of a single word', () => {
		expect(deriveProjectKey('Specboard')).toBe('SPE');
	});

	it('falls back when the derived key would be invalid', () => {
		// A leading digit would make `123-45` ambiguous to parse.
		expect(deriveProjectKey('123')).toBe('PRJ');
		// Too short to be a key.
		expect(deriveProjectKey('A')).toBe('PRJ');
		expect(deriveProjectKey('!!!')).toBe('PRJ');
	});

	it('always produces something the validator accepts', () => {
		for (const name of ['Specboard', '!!!', '   ', 'A', '123', '9 Lives', 'a'.repeat(200)]) {
			expect(isValidProjectKey(deriveProjectKey(name))).toBe(true);
		}
	});
});

describe('isValidProjectSlug', () => {
	it.each(['specboard', 'dual-deck-builder', 'a1', '123'])('accepts %s', (slug) => {
		expect(isValidProjectSlug(slug)).toBe(true);
	});

	it.each(['', '-leading', 'trailing-', 'double--hyphen', 'Upper', 'has space', 'under_score'])(
		'rejects %s',
		(slug) => {
			expect(isValidProjectSlug(slug)).toBe(false);
		}
	);

	it('rejects anything over the length cap', () => {
		expect(isValidProjectSlug('a'.repeat(MAX_PROJECT_SLUG_LENGTH + 1))).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidProjectSlug(undefined)).toBe(false);
		expect(isValidProjectSlug(42)).toBe(false);
	});
});

describe('isValidProjectKey', () => {
	it.each(['SB', 'DDB', 'A1', 'ABCDEFGHIJ'])('accepts %s', (key) => {
		expect(isValidProjectKey(key)).toBe(true);
	});

	it.each(['S', 'sb', '1SB', 'SB-1', 'ABCDEFGHIJK', ''])('rejects %s', (key) => {
		expect(isValidProjectKey(key)).toBe(false);
	});
});

describe('item keys', () => {
	it('formats as KEY-NUMBER', () => {
		expect(formatItemKey('SB', 345)).toBe('SB-345');
	});

	it('round-trips through parsing', () => {
		expect(parseItemKey(formatItemKey('SB', 345))).toEqual({ projectKey: 'SB', number: 345 });
	});

	it('accepts a hand-typed lowercase key from the address bar', () => {
		expect(parseItemKey('sb-345')).toEqual({ projectKey: 'SB', number: 345 });
		expect(parseItemKey('  Sb-345  ')).toEqual({ projectKey: 'SB', number: 345 });
	});

	it.each(['SB', '345', 'SB-', '-345', 'SB-0', 'SB--1', 'SB-1.5', 'SB--1', '1SB-2', 'SB 345'])(
		'rejects %s',
		(key) => {
			expect(parseItemKey(key)).toBeNull();
		}
	);

	it('rejects a number too long to be a real item', () => {
		expect(parseItemKey('SB-1234567890')).toBeNull();
	});
});

describe('withSuffix', () => {
	it('leaves the first attempt untouched', () => {
		expect(withSuffix('docs', 1, 'slug')).toBe('docs');
		expect(withSuffix('DOC', 1, 'key')).toBe('DOC');
	});

	it('suffixes slugs with a hyphen and keys without one', () => {
		expect(withSuffix('docs', 2, 'slug')).toBe('docs-2');
		expect(withSuffix('DOC', 2, 'key')).toBe('DOC2');
	});

	it('keeps suffixed values inside their length limits', () => {
		const slug = withSuffix('a'.repeat(MAX_PROJECT_SLUG_LENGTH), 10, 'slug');
		expect(slug.length).toBeLessThanOrEqual(MAX_PROJECT_SLUG_LENGTH);
		expect(isValidProjectSlug(slug)).toBe(true);

		const key = withSuffix('ABCDEFGHIJ', 10, 'key');
		expect(key.length).toBeLessThanOrEqual(MAX_PROJECT_KEY_LENGTH);
		expect(isValidProjectKey(key)).toBe(true);
	});

	// Truncating to make room for the suffix can land the cut on a hyphen, which
	// would yield `foo--2` — invalid, and rejected by the DB CHECK as a 500.
	it('never emits a doubled hyphen when the cut lands on one', () => {
		const base = `${'a'.repeat(52)}-bb`;
		expect(base.length).toBe(55);
		for (const attempt of [2, 3, 9, 10, 99, 100]) {
			const slug = withSuffix(base, attempt, 'slug');
			expect(slug).not.toContain('--');
			expect(isValidProjectSlug(slug)).toBe(true);
		}
	});

	it('stays valid for a hyphen at every position near the cut', () => {
		for (let hyphenAt = 40; hyphenAt < MAX_PROJECT_SLUG_LENGTH; hyphenAt++) {
			const base = `${'a'.repeat(hyphenAt)}-${'b'.repeat(MAX_PROJECT_SLUG_LENGTH - hyphenAt - 1)}`;
			for (const attempt of [2, 10, 100]) {
				expect(isValidProjectSlug(withSuffix(base, attempt, 'slug'))).toBe(true);
			}
		}
	});
});

describe('itemNumberInProject', () => {
	it('returns the number for a key belonging to the project', () => {
		expect(itemNumberInProject('SB-345', 'SB')).toBe(345);
	});

	it('accepts a lowercase key', () => {
		expect(itemNumberInProject('sb-345', 'SB')).toBe(345);
	});

	it("rejects a well-formed key carrying another project's prefix", () => {
		expect(itemNumberInProject('XX-1', 'SB')).toBeNull();
	});

	it.each([undefined, null, 42, {}, 'nonsense', 'SB-0'])('rejects %s', (key) => {
		expect(itemNumberInProject(key, 'SB')).toBeNull();
	});
});
