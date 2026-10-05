import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The reduced-motion pass (spec, Live updates and motion): everything the Map moves cuts under
 * `prefers-reduced-motion: reduce`. The JavaScript that moves things takes `reducedMotion()` and
 * is tested beside it (focus fade, zoom levels, drag spring-back, the surface, the camera); this
 * is the rest: a stylesheet that animates or transitions anything must carry its own cut.
 */

const here = new URL('./', import.meta.url);
const sheets = (readdirSync(here, { recursive: true }) as string[]).filter((path) => path.endsWith('.module.css'));
const REDUCED = /@media \(prefers-reduced-motion: reduce\)/;

describe('the Map\'s stylesheets', () => {
	it('are found', () => {
		expect(sheets.length).toBeGreaterThan(10);
	});

	describe.each(sheets)('%s', (path) => {
		const source = readFileSync(new URL(path, here), 'utf8');
		const [outside, cut = ''] = source.split(REDUCED) as [string, string?];

		it('cuts every transition it has', () => {
			if (/\btransition\s*:/.test(outside)) expect(cut).toMatch(/transition:\s*none/);
		});

		it('cuts every animation it has', () => {
			if (/\banimation\s*:/.test(outside)) expect(cut).toMatch(/animation:\s*none/);
		});
	});
});
