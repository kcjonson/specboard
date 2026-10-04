import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_CONTRAST, contrast, parseColor, type Rgb } from './color';

/**
 * Canvas text sits on a halo of the surface (dot labels) or on a pill of it (region
 * labels), and card text on the surface or the badge's tint. So what every text color
 * has to clear is those grounds, in both themes, read from the tokens themselves.
 */
const css = readFileSync(new URL('../../ui/src/tokens.css', import.meta.url), 'utf8');
const [lightCss, darkCss] = css.split('@media (prefers-color-scheme: dark)') as [string, string];

const token = (source: string, name: string): Rgb => {
	const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(source);
	const color = match ? parseColor(match[1]!) : null;
	if (!color) throw new Error(`${name} is not a hex color in the tokens`);
	return color;
};

describe.each([['light', lightCss], ['dark', darkCss]] as const)('label ink in %s', (_theme, source) => {
	const surface = token(source, '--color-surface');
	const hover = token(source, '--color-surface-hover');
	const muted = token(source, '--color-text-muted');
	const text = token(source, '--color-text');

	it('clears 4.5:1 against the surface it is drawn on', () => {
		expect(contrast(muted, surface)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
		expect(contrast(text, surface)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
	});

	it('clears 4.5:1 for card chips: ink on the badge tint', () => {
		expect(contrast(text, hover)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
	});
});
