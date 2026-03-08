import { describe, it, expect } from 'vitest';
import { isConventionFile } from './repo-conventions.ts';

describe('isConventionFile', () => {
	it('returns true for CLAUDE.md at root', () => {
		expect(isConventionFile('/CLAUDE.md')).toBe(true);
	});

	it('returns true for AGENT.md at root', () => {
		expect(isConventionFile('/AGENT.md')).toBe(true);
	});

	it('returns true for CLAUDE.md in subdirectory', () => {
		expect(isConventionFile('/docs/CLAUDE.md')).toBe(true);
	});

	it('returns false for regular markdown files', () => {
		expect(isConventionFile('/docs/readme.md')).toBe(false);
	});

	it('returns false for similarly named files', () => {
		expect(isConventionFile('/CLAUDE.txt')).toBe(false);
		expect(isConventionFile('/MY-CLAUDE.md')).toBe(false);
	});

	it('returns false for empty path', () => {
		expect(isConventionFile('')).toBe(false);
	});

	it('is case-sensitive', () => {
		expect(isConventionFile('/claude.md')).toBe(false);
		expect(isConventionFile('/agent.md')).toBe(false);
	});
});
