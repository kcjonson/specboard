import type { MapItemStatus } from '@specboard/core/map-read';
import { NEEDS_PERSON_TOKEN, STATUS_TOKENS } from '@specboard/ui';
import { NON_TEXT_CONTRAST, contrast, type Rgb } from './color';
import type { MapPhase } from './layout/types';

/**
 * The base colors the canvas draws with (spec, Accessibility): the design tokens normally, and
 * under `forced-colors: active` the user's system colors. A canvas is just pixels, so the
 * browser's forced palette never reaches it; the Map has to ask for the colors and draw with
 * them, or its glyphs, chain links, and region outlines would stay in the theme's tints on a
 * surface the person has set to their own.
 */

/** The CSS system colors the forced palette is made from. */
export type SystemColor = 'Canvas' | 'CanvasText' | 'GrayText' | 'LinkText' | 'VisitedText';

export interface ColorSource {
	/** A design token's color, from the page's own theme. */
	token(name: string): Rgb;
	/** A system color keyword, as the browser resolves it for the page now. */
	system(keyword: SystemColor): Rgb;
}

export interface ThemeColors {
	forced: boolean;
	surface: Rgb;
	border: Rgb;
	muted: Rgb;
	text: Rgb;
	needsPerson: Rgb;
	/** The accent: the changed-item halo reduced motion shows in place of motion. */
	highlight: Rgb;
	/** Live agent work: its glow and its lines. */
	agent: Rgb;
	status: Record<MapItemStatus, Rgb>;
	/** What each phase of a rollup bar is drawn in. */
	phase: Record<MapPhase, Rgb>;
}

const STATUSES = Object.keys(STATUS_TOKENS) as MapItemStatus[];

export const PHASE_STATUS: Record<MapPhase, MapItemStatus> = { done: 'done', in_flight: 'in_progress', next: 'ready', later: 'blocked' };

/** The system color for ink that has to be seen on the canvas: itself if the person's palette keeps it apart from the canvas, CanvasText if not. */
function legible(color: Rgb, surface: Rgb, fallback: Rgb): Rgb {
	return contrast(color, surface) >= NON_TEXT_CONTRAST ? color : fallback;
}

export function themeColors(forced: boolean, source: ColorSource): ThemeColors {
	if (!forced) {
		const status = {} as Record<MapItemStatus, Rgb>;
		for (const key of STATUSES) status[key] = source.token(STATUS_TOKENS[key]);
		const phase = {} as Record<MapPhase, Rgb>;
		for (const key of Object.keys(PHASE_STATUS) as MapPhase[]) phase[key] = status[PHASE_STATUS[key]];
		return {
			forced,
			surface: source.token('--color-surface'),
			border: source.token('--color-border'),
			muted: source.token('--color-text-muted'),
			text: source.token('--color-text'),
			needsPerson: source.token(NEEDS_PERSON_TOKEN),
			highlight: source.token('--color-primary'),
			agent: status.in_progress,
			status,
			phase,
		};
	}
	const surface = source.system('Canvas');
	const text = source.system('CanvasText');
	const gray = legible(source.system('GrayText'), surface, text);
	const link = legible(source.system('LinkText'), surface, text);
	const visited = legible(source.system('VisitedText'), surface, text);
	// Status is told by the glyph's shape, never by its color, so every glyph is the palette's text color.
	const status = {} as Record<MapItemStatus, Rgb>;
	for (const key of STATUSES) status[key] = text;
	return {
		forced,
		surface,
		border: gray,
		muted: gray,
		text,
		needsPerson: link,
		highlight: link,
		agent: link,
		status,
		// A rollup bar has nothing but color to split its phases by, so each gets its own system color.
		phase: { done: text, in_flight: link, next: visited, later: gray },
	};
}
