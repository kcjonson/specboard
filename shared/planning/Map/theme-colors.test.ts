import { describe, expect, it } from 'vitest';
import { NON_TEXT_CONTRAST, contrast, type Rgb } from './color';
import { themeColors, type ColorSource, type SystemColor } from './theme-colors';

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

const TOKENS: Record<string, Rgb> = {
	'--color-surface': rgb(255, 255, 255),
	'--color-border': rgb(200, 200, 200),
	'--color-text-muted': rgb(100, 100, 100),
	'--color-text': rgb(20, 20, 20),
};

/** A source that answers every token with a distinct color, and the system colors with the given palette. */
function source(system: Partial<Record<SystemColor, Rgb>>): ColorSource & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		token: (name) => {
			asked.push(`token:${name}`);
			return TOKENS[name] ?? rgb(10 * name.length, 40, 90);
		},
		system: (keyword) => {
			asked.push(`system:${keyword}`);
			return system[keyword] ?? rgb(0, 0, 0);
		},
	};
}

const WHITE_ON_BLACK = { Canvas: rgb(0, 0, 0), CanvasText: rgb(255, 255, 255), GrayText: rgb(63, 242, 63), LinkText: rgb(255, 255, 0), VisitedText: rgb(0, 255, 255) };

describe('theme colors', () => {
	it('come from the design tokens when forced colors is off, and never ask for a system color', () => {
		const s = source(WHITE_ON_BLACK);
		const colors = themeColors(false, s);
		expect(colors.forced).toBe(false);
		expect(colors.surface).toEqual(TOKENS['--color-surface']);
		expect(colors.text).toEqual(TOKENS['--color-text']);
		expect(s.asked.some((ask) => ask.startsWith('system:'))).toBe(false);
	});

	it('keep each status its own color and each rollup phase its status\'s', () => {
		const colors = themeColors(false, source({}));
		expect(new Set(Object.values(colors.status).map((c) => `${c.r},${c.g},${c.b}`)).size).toBeGreaterThan(1);
		expect(colors.phase.done).toEqual(colors.status.done);
		expect(colors.phase.in_flight).toEqual(colors.status.in_progress);
		expect(colors.phase.next).toEqual(colors.status.ready);
		expect(colors.phase.later).toEqual(colors.status.blocked);
		expect(colors.agent).toEqual(colors.status.in_progress);
	});

	it('come from the system palette under forced colors, and never from a token', () => {
		const s = source(WHITE_ON_BLACK);
		const colors = themeColors(true, s);
		expect(colors.forced).toBe(true);
		expect(colors.surface).toEqual(WHITE_ON_BLACK.Canvas);
		expect(colors.text).toEqual(WHITE_ON_BLACK.CanvasText);
		expect(colors.muted).toEqual(WHITE_ON_BLACK.GrayText);
		expect(colors.border).toEqual(WHITE_ON_BLACK.GrayText);
		expect(s.asked.some((ask) => ask.startsWith('token:'))).toBe(false);
	});

	it('draw every glyph in the palette\'s text color, since shape tells status and color does not', () => {
		const colors = themeColors(true, source(WHITE_ON_BLACK));
		for (const status of Object.values(colors.status)) expect(status).toEqual(WHITE_ON_BLACK.CanvasText);
	});

	it('give a rollup bar a color per phase under forced colors, since color is all it has to split them by', () => {
		const colors = themeColors(true, source(WHITE_ON_BLACK));
		const phases = Object.values(colors.phase).map((c) => `${c.r},${c.g},${c.b}`);
		expect(new Set(phases).size).toBe(4);
	});

	it('ring what needs a person and light agents in the link color', () => {
		const colors = themeColors(true, source(WHITE_ON_BLACK));
		expect(colors.needsPerson).toEqual(WHITE_ON_BLACK.LinkText);
		expect(colors.agent).toEqual(WHITE_ON_BLACK.LinkText);
	});

	it('fall back to the text color for any system color the person\'s palette puts too close to the canvas', () => {
		const palette = { Canvas: rgb(255, 255, 255), CanvasText: rgb(0, 0, 0), GrayText: rgb(250, 250, 250), LinkText: rgb(245, 245, 245), VisitedText: rgb(240, 240, 240) };
		const colors = themeColors(true, source(palette));
		for (const ink of [colors.muted, colors.border, colors.needsPerson, colors.agent, ...Object.values(colors.phase)]) {
			expect(contrast(ink, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
		}
		expect(colors.muted).toEqual(palette.CanvasText);
	});

	it('keep the Windows high contrast palettes\' own colors, which already clear 3:1 on their canvas', () => {
		for (const palette of [WHITE_ON_BLACK, { Canvas: rgb(255, 255, 255), CanvasText: rgb(0, 0, 0), GrayText: rgb(0, 128, 0), LinkText: rgb(0, 0, 255), VisitedText: rgb(128, 0, 128) }]) {
			const colors = themeColors(true, source(palette));
			expect(colors.muted).toEqual(palette.GrayText);
			expect(colors.needsPerson).toEqual(palette.LinkText);
			expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
		}
	});
});
