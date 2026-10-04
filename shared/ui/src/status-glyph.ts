import type { ItemStatus } from '@specboard/models';

/**
 * Geometry and color tokens for the status glyphs, shared by the DOM component
 * (StatusGlyph) and the Map's Canvas 2D renderer. Framework-free on purpose.
 *
 * Every path is SVG path data in a GLYPH_BOX square, so the canvas draws them with
 * `new Path2D(d)` under a scale transform and the component puts them in an <svg>.
 * Shape carries every distinction that hue does: a ring that fills clockwise from
 * twelve o'clock (empty, half, three quarters), a full disc with the check cut out,
 * and an octagon.
 */

export const GLYPH_BOX = 16;

/** Stroke width for `stroke` paths, in GLYPH_BOX units. */
export const RING_WIDTH = 1.5;

/** CSS custom properties from tokens.css; resolve them against the surface being drawn on. */
export const STATUS_TOKENS: Record<ItemStatus, string> = {
	ready: '--color-ready',
	in_progress: '--color-in-progress',
	in_review: '--color-in-review',
	done: '--color-done',
	blocked: '--color-blocked',
};

/** The ink ring around an item that needs a person. */
export const NEEDS_PERSON_TOKEN = '--color-needs-person';

export interface StatusGlyphSpec {
	/** Token for both the stroke and the fill. */
	token: string;
	/** Share of the glyph that is filled: 0, 0.5, 0.75, or 1. */
	filled: number;
	/** Path to draw as a RING_WIDTH stroke with no fill. */
	stroke?: string;
	/** Path to fill with the even-odd rule, which is what cuts the check out of the disc. */
	fill?: string;
}

const CENTER = GLYPH_BOX / 2;
const RING_RADIUS = 6.5;
const PIE_RADIUS = 4.25;
const DISC_RADIUS = 7.25;
const OCTAGON_RADIUS = 7.5;

/** The check as a closed outline, so the even-odd rule leaves it empty inside the disc. */
const CHECK_CUTOUT = 'M3.8 8.8L7.04 12.04L12.24 6.16L10.96 5.04L6.96 9.56L5 7.6Z';

function circle(radius: number): string {
	return `M${CENTER - radius} ${CENTER}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
}

function pie(filled: number): string {
	const angle = -Math.PI / 2 + filled * 2 * Math.PI;
	const x = +(CENTER + PIE_RADIUS * Math.cos(angle)).toFixed(3);
	const y = +(CENTER + PIE_RADIUS * Math.sin(angle)).toFixed(3);
	const large = filled > 0.5 ? 1 : 0;
	return `M${CENTER} ${CENTER}L${CENTER} ${CENTER - PIE_RADIUS}A${PIE_RADIUS} ${PIE_RADIUS} 0 ${large} 1 ${x} ${y}Z`;
}

function octagon(): string {
	const points = Array.from({ length: 8 }, (_, k) => {
		const angle = (22.5 + 45 * k) * (Math.PI / 180);
		const x = +(CENTER + OCTAGON_RADIUS * Math.cos(angle)).toFixed(2);
		const y = +(CENTER + OCTAGON_RADIUS * Math.sin(angle)).toFixed(2);
		return `${x} ${y}`;
	});
	return `M${points.join('L')}Z`;
}

export const STATUS_GLYPHS: Record<ItemStatus, StatusGlyphSpec> = {
	ready: { token: STATUS_TOKENS.ready, filled: 0, stroke: circle(RING_RADIUS) },
	in_progress: { token: STATUS_TOKENS.in_progress, filled: 0.5, stroke: circle(RING_RADIUS), fill: pie(0.5) },
	in_review: { token: STATUS_TOKENS.in_review, filled: 0.75, stroke: circle(RING_RADIUS), fill: pie(0.75) },
	done: { token: STATUS_TOKENS.done, filled: 1, fill: circle(DISC_RADIUS) + CHECK_CUTOUT },
	blocked: { token: STATUS_TOKENS.blocked, filled: 1, fill: octagon() },
};

/** The done disc without its check: a folded family's dot, which carries its count there instead. */
export const DONE_DISC = circle(DISC_RADIUS);

/** The paused cue, two bars: drawn in a ring glyph's color in place of its fill, or cut out of a solid glyph. */
export const PAUSE_BARS = 'M5.25 4.75h2v6.5h-2zM8.75 4.75h2v6.5h-2z';

/**
 * The status a glyph shows. The derived `blocked` flag (a hold, or an open blocker
 * row under any status) wins, so a Ready item waiting on another item reads as blocked.
 */
export function glyphStatus(status: ItemStatus, blocked?: boolean): ItemStatus {
	return blocked ? 'blocked' : status;
}
