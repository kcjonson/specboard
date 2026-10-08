import { describe, it, expect } from 'vitest';
import { isInSkippedDirectory } from './sync-paths.ts';

describe('isInSkippedDirectory', () => {
	it.each([
		['node_modules/x/README.md', true],
		['/docs/build/out.md', true],
		['packages/a/.git/config', true],
		['docs/readme.md', false],
		['docs/mynode_modules/a.md', false],
		// Names are matched whole, not as patterns: ".git" isn't "xgit".
		['docs/xgit/a.md', false],
		// The file's own name doesn't count, only directories.
		['docs/build', false],
	])('%s → %s', (path, skipped) => {
		expect(isInSkippedDirectory(path)).toBe(skipped);
	});
});
