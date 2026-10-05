import type { MapItemStatus } from '@specboard/core/map-read';
import { DONE_DISC, GLYPH_BOX, PAUSE_BARS, RING_WIDTH, STATUS_GLYPHS, STATUS_TOKENS } from '@specboard/ui';
import type { Transform } from './camera';
import type { CollapseControl } from './collapse-controls';
import { TEXT_CONTRAST, contrast, contrastFloor, formatColor, isDark, mix, parseColor, readableInk, type Rgb } from './color';
import { agentRadius, markExtra, screenRadius } from './dot-boxes';
import { DOT_LABEL_PAD, type DotLabel, type LabelFont } from './dot-labels';
import type { DrawAgent, DrawDot, DrawLink } from './draw-list';
import { FADE_DARK, FADE_LIGHT, FOCUS_GROW, darkness, dotStrength, growth, linkStrength, regionStrength, type FocusFrame } from './focus-fade';
import type { DragOffset } from './overlay';
import type { MapPhase } from './layout/types';
import type { ZoomLevel } from './zoom-levels';
import { BLOCK_LINE_HEIGHT, type PlacedBlock } from './label-placement';
import { linkCurve } from './links';
import { REASON_TAGS } from './needs-person';
import { ringScale, tintAmount } from './plan-weight';
import { themeColors, type SystemColor, type ThemeColors } from './theme-colors';
import { rollupSegments, type Circle, type RegionLabel } from './region-labels';
import type { RegionOutline } from './regions/outline';
import { EDGE_LABEL_TOP, edgeLabelAt, type RulerMarks } from './ruler';

/** Height of the ruler band along the bottom of the canvas, in CSS pixels. */
export const RULER_HEIGHT = 32;

/** What one repaint draws. The renderer takes this and nothing else, so tests and later layers can build frames freely. */
export interface MapFrame {
	dots: readonly DrawDot[];
	/** Outer regions first, so nested ones draw over them. */
	regions: readonly RegionOutline[];
	links: readonly DrawLink[];
	/** Every blocker and discovered-from link draws, not only the ones focus lights. */
	allLinks: boolean;
	labels: readonly RegionLabel[];
	dotLabels: readonly DotLabel[];
	/** Computers and sessions, and the text blocks that name the work in each computer's cluster. */
	agents: readonly DrawAgent[];
	blocks: readonly PlacedBlock[];
	controls: readonly CollapseControl[];
	/** The dots that near-level cards stand in for, and how opaque those cards are: the canvas draws them as the cards fade out, and not at all once the cards are there. */
	cards: { keys: ReadonlySet<string>; alpha: number } | null;
	/** What hover, focus, selection, or a search or filter has lit and how far its fade has run; everything outside the related set draws at a share of its strength. */
	focus: FocusFrame;
	/** Regions whose own parent matches the search or filter: their outline draws lit. */
	outlined: ReadonlySet<string>;
	/** The key the keyboard has focus on. A dot grows and rings as it does under the pointer; a region's label gets a ring of its own. */
	ringed: string | null;
	/** A dot being dragged, drawn that far from its place, on top. */
	drag: DragOffset | null;
	transform: Transform;
	/** The zoom level, which sizes the glyphs: at the near level they hold one size whatever the scale. */
	level: ZoomLevel;
	/** Null until the layout settles: only the ruler's frame draws. */
	ruler: RulerMarks | null;
}

export interface MapRenderer {
	/** The canvas's CSS size, ruler band included. */
	resize(width: number, height: number): void;
	/** Reads the theme tokens again, for a light/dark change. */
	refreshTheme(): void;
	/** A label's text width in CSS pixels, at the font the label draws in. */
	measureLabel(text: string, font: LabelFont): number;
	draw(frame: MapFrame): void;
}

const STATUSES = Object.keys(STATUS_TOKENS) as MapItemStatus[];

/** Each nesting level out tints its region a little deeper. */
const REGION_TINT = 0.04;
const REGION_TINT_STEP = 0.025;
const REGION_TINT_LEVELS = 4;
const REGION_STROKE = 0.2;
const REGION_STROKE_FOCUS = 0.75;

interface MapTheme {
	surface: string;
	border: string;
	muted: string;
	text: string;
	needsPerson: string;
	/** Live agent work: the amber of In progress, for sessions' lines and the glow behind them and their items. */
	agent: string;
	agentRgb: Rgb;
	/** Computers and sessions: ink a little softer than text. */
	machine: string;
	font: string;
	status: Record<MapItemStatus, string>;
	/** What each phase of a rollup bar is drawn in. */
	phase: Record<MapPhase, string>;
	/** The least of each status color a weighted mark keeps and still clears 3:1 on the surface. */
	floor: Record<MapItemStatus, number>;
	statusRgb: Record<MapItemStatus, Rgb>;
	surfaceRgb: Rgb;
	/** By height - 1, deeper for regions with more nested inside. */
	regionFill: string[];
	regionStroke: string;
	/** A region's outline when it is the one in focus: darker than at rest. */
	regionStrokeFocus: string;
	/** What unrelated marks keep while something is in focus: less on a dark surface, where 30% would vanish. */
	fade: number;
	link: string;
	linkSatisfied: string;
	/** The count on a folded finished family: whichever ink clears text contrast on the done fill. */
	countInk: string;
	/**
	 * Dot labels sit on a halo of the surface, so what they have to clear is the surface:
	 * muted ink if it reaches text contrast there, and full ink if a theme's muted doesn't.
	 */
	labelInk: string;
}

/**
 * Tokens resolved against the canvas, so light and dark both come out of the same
 * names. A canvas normalizes any CSS color it's given, which is what lets the
 * contrast floor and the region tints be computed from whatever the tokens hold.
 */
function readTheme(element: Element, normalize: (color: string) => string, forced: boolean): MapTheme {
	const style = window.getComputedStyle(element);
	const rgbOf = (name: string): Rgb => {
		const rgb = parseColor(normalize(style.getPropertyValue(name).trim()));
		if (!rgb) throw new Error(`Map theme token ${name} is not a color`);
		return rgb;
	};
	// A system color keyword is resolved the way the page sees it, by asking the browser what it computes a probe's color to be.
	const probe = document.createElement('span');
	const system = (keyword: SystemColor): Rgb => {
		probe.style.color = keyword;
		const rgb = parseColor(normalize(window.getComputedStyle(probe).color));
		if (!rgb) throw new Error(`System color ${keyword} is not a color`);
		return rgb;
	};
	(element.parentElement ?? document.body).appendChild(probe);
	let colors: ThemeColors;
	try {
		colors = themeColors(forced, { token: rgbOf, system });
	} finally {
		probe.remove();
	}
	const { surface: surfaceRgb, text: textRgb, muted: mutedRgb, status: statusRgb } = colors;
	const status = {} as Record<MapItemStatus, string>;
	const floor = {} as Record<MapItemStatus, number>;
	for (const key of STATUSES) {
		status[key] = formatColor(statusRgb[key]);
		floor[key] = contrastFloor(statusRgb[key], surfaceRgb);
	}
	const phase = {} as Record<MapPhase, string>;
	for (const key of Object.keys(colors.phase) as MapPhase[]) phase[key] = formatColor(colors.phase[key]);
	const surface = formatColor(surfaceRgb);
	const text = formatColor(textRgb);
	return {
		surface,
		border: formatColor(colors.border),
		muted: formatColor(mutedRgb),
		text,
		needsPerson: formatColor(colors.needsPerson),
		agent: formatColor(colors.agent),
		agentRgb: colors.agent,
		machine: forced ? text : formatColor(mix(textRgb, surfaceRgb, 0.82)),
		font: style.fontFamily || 'sans-serif',
		status,
		phase,
		floor,
		statusRgb,
		surfaceRgb,
		// Forced colors leave regions untinted and outlined in ink: a tint is a blend of two colors the person didn't choose.
		regionFill: Array.from({ length: REGION_TINT_LEVELS }, (_, level) =>
			forced ? surface : formatColor(mix(textRgb, surfaceRgb, REGION_TINT + REGION_TINT_STEP * level)),
		),
		regionStroke: forced ? text : formatColor(mix(textRgb, surfaceRgb, REGION_STROKE)),
		regionStrokeFocus: forced ? text : formatColor(mix(textRgb, surfaceRgb, REGION_STROKE_FOCUS)),
		fade: isDark(surfaceRgb) ? FADE_DARK : FADE_LIGHT,
		countInk: formatColor(readableInk(statusRgb.done, [surfaceRgb, textRgb])),
		labelInk: formatColor(contrast(mutedRgb, surfaceRgb) >= TEXT_CONTRAST ? mutedRgb : textRgb),
		link: forced ? text : formatColor(mix(mutedRgb, surfaceRgb, 0.85)),
		linkSatisfied: forced ? formatColor(mutedRgb) : formatColor(mix(mutedRgb, surfaceRgb, 0.4)),
	};
}

/** The glyph art spans this much of its box from the center, so a dot's radius maps to it. */
const GLYPH_REACH = 7.5;

const LABEL_SIZE = 11;
const REGION_LABEL_SIZE = 12;
/** The surface halo under dot-label text, in px of stroke. */
const HALO_WIDTH = 3;
const TICK_LENGTH = 6;
/** Every dot sits on a disc of the surface this much wider than itself, so a region's tint never changes its contrast. */
const BACKING = 1.5;
/** The needs-a-person ring: a gap of surface, then ink. */
const INK_GAP = 2;
const INK_WIDTH = 1.5;
/** A folded dot writes its count inside once it's this big on screen. */
const COUNT_MIN_RADIUS = 8;
/** The focus ring: a gap of surface, then ink, outside the needs-a-person ring when the dot has one. */
const FOCUS_GAP = 2;
const FOCUS_WIDTH = 2;
/** The reason tag and the up-next number: small marks at a dot's upper right, past its ring. */
const MARK_SIZE = 14;
const MARK_FONT = 9;
const SCOPING_DASH = [2.2, 1.4];
/** The dashed scoping ring around a solid glyph, in glyph units: just outside the octagon. */
const SCOPING_RING = 8.75;
const DISCOVERED_DASH = [2, 3];
/** The still glow behind live work reaches this far past the mark, and is this strong at its heart. */
const GLOW_REACH = 11;
const GLOW_STRENGTH = 0.42;
const QUIET_DASH = [4, 3];
/** A laptop, in a 20-unit box: the screen, and the base under it. */
const LAPTOP = 'M4 5.5 H16 V13 H4 Z M2 15.5 H18';
const LAPTOP_BOX = 20;

interface GlyphPaths {
	stroke?: Path2D;
	fill?: Path2D;
}

function glyphPaths(): Record<MapItemStatus, GlyphPaths> {
	const paths = {} as Record<MapItemStatus, GlyphPaths>;
	for (const key of STATUSES) {
		const { stroke, fill } = STATUS_GLYPHS[key];
		paths[key] = { stroke: stroke ? new Path2D(stroke) : undefined, fill: fill ? new Path2D(fill) : undefined };
	}
	return paths;
}

/** Path2D for an outline's smoothed curve, in layout units. */
function outlinePath(outline: RegionOutline): Path2D {
	const { curve } = outline;
	const path = new Path2D();
	path.moveTo(curve[0]!, curve[1]!);
	for (let i = 2; i < curve.length; i += 4) path.quadraticCurveTo(curve[i]!, curve[i + 1]!, curve[i + 2]!, curve[i + 3]!);
	path.closePath();
	return path;
}

/** One Canvas 2D layer, sized for the device's pixel ratio and repainted only when asked. */
export function createCanvasRenderer(canvas: HTMLCanvasElement): MapRenderer {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D is not available');
	const paths = glyphPaths();
	const doneDisc = new Path2D(DONE_DISC);
	const pauseBars = new Path2D(PAUSE_BARS);
	const laptop = new Path2D(LAPTOP);
	const outlines = new WeakMap<RegionOutline, Path2D>();
	const normalize = (color: string): string => {
		ctx.fillStyle = '#000000';
		ctx.fillStyle = color;
		return String(ctx.fillStyle);
	};
	const forcedColors = typeof window.matchMedia === 'function' ? window.matchMedia('(forced-colors: active)') : null;
	let theme = readTheme(canvas, normalize, forcedColors?.matches ?? false);
	const tints = new Map<string, string>();
	const widths = new Map<string, number>();
	let width = 0;
	let height = 0;
	let ratio = 0;

	const fit = (): void => {
		ratio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(width * ratio));
		canvas.height = Math.max(1, Math.round(height * ratio));
	};

	const plotHeight = (): number => height - RULER_HEIGHT;
	const offscreen = (x: number, y: number, r: number): boolean => x + r < 0 || x - r > width || y + r < 0 || y - r > plotHeight();

	/** A status color tinted toward the surface by plan weight, never past the contrast floor. */
	const tinted = (status: MapItemStatus, weight: number): string => {
		// Rounded up to whole percents, so a cached tint never dips under the floor.
		const amount = Math.ceil(tintAmount(weight, theme.floor[status]) * 100) / 100;
		if (amount >= 1) return theme.status[status];
		const key = `${status}:${amount}`;
		let color = tints.get(key);
		if (!color) {
			color = formatColor(mix(theme.statusRgb[status], theme.surfaceRgb, amount));
			tints.set(key, color);
		}
		return color;
	};

	const fontOf = (font: LabelFont): string =>
		font === 'region' ? `600 ${REGION_LABEL_SIZE}px ${theme.font}` : `${font === 'dot-strong' ? 600 : 500} ${LABEL_SIZE}px ${theme.font}`;

	const disc = (x: number, y: number, r: number, color: string): void => {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, 2 * Math.PI);
		ctx.fill();
	};

	const ring = (x: number, y: number, r: number, color: string, lineWidth: number): void => {
		ctx.strokeStyle = color;
		ctx.lineWidth = lineWidth;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, 2 * Math.PI);
		ctx.stroke();
	};

	/** A status glyph of on-screen radius `r` centered at (x, y), with its cues. */
	const drawGlyph = (
		x: number,
		y: number,
		r: number,
		status: MapItemStatus,
		{ weight = 1, cue = null, count = null }: Pick<Partial<DrawDot>, 'weight' | 'cue'> & { count?: number | null } = {},
	): void => {
		const scale = r / GLYPH_REACH;
		const { stroke, fill } = paths[status];
		const color = tinted(status, weight);
		ctx.save();
		ctx.translate(x - (GLYPH_BOX / 2) * scale, y - (GLYPH_BOX / 2) * scale);
		ctx.scale(scale, scale);
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		// Hairlines stay a pixel wide on a small dot.
		ctx.lineWidth = Math.max(RING_WIDTH * ringScale(weight), 1 / scale);
		if (stroke) {
			if (cue === 'scoping') ctx.setLineDash(SCOPING_DASH);
			ctx.stroke(stroke);
			ctx.setLineDash([]);
		} else if (cue === 'scoping') {
			// A solid glyph (blocked, say) has no ring to dash, so scoping gets a dashed ring around it.
			ctx.setLineDash(SCOPING_DASH);
			ctx.beginPath();
			ctx.arc(GLYPH_BOX / 2, GLYPH_BOX / 2, SCOPING_RING, 0, 2 * Math.PI);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		if (count !== null && status === 'done') {
			ctx.fill(doneDisc);
		} else if (cue === 'paused' && stroke) {
			// A ring glyph shows the bars in place of its fill.
			ctx.fill(pauseBars);
		} else if (fill) {
			ctx.fill(fill, 'evenodd');
			if (cue === 'paused') {
				ctx.fillStyle = theme.surface;
				ctx.fill(pauseBars);
			}
		}
		ctx.restore();
		if (count !== null && status === 'done') {
			ctx.fillStyle = theme.countInk;
			ctx.font = `700 ${Math.min(13, Math.round(r * 0.85))}px ${theme.font}`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(count), x, y + 0.5);
		}
	};

	/** A small diamond at the lower right of a glyph: the item has a PR. */
	const drawPrMark = (x: number, y: number, r: number): void => {
		const size = Math.max(2, r * 0.38);
		const at = (r + size * 0.4) * Math.SQRT1_2;
		ctx.save();
		ctx.translate(x + at, y + at);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = theme.surface;
		ctx.fillRect(-size / 2 - 1, -size / 2 - 1, size + 2, size + 2);
		ctx.fillStyle = theme.muted;
		ctx.fillRect(-size / 2, -size / 2, size, size);
		ctx.restore();
	};

	/** Where a mark's center goes: the dot's upper right, clear of its ring. */
	const markAt = (x: number, y: number, r: number): { x: number; y: number } => {
		const reach = (r + INK_GAP + INK_WIDTH + MARK_SIZE / 2) * Math.SQRT1_2;
		return { x: x + reach, y: y - reach };
	};

	/** The reason a dot needs a person, in a word or two of ink: ? for a question, PR for review, zz for a quiet agent, ! for a hold. */
	const drawReasonTag = (x: number, y: number, r: number, text: string): void => {
		ctx.font = `700 ${MARK_FONT}px ${theme.font}`;
		const w = Math.max(MARK_SIZE, ctx.measureText(text).width + 6);
		const at = markAt(x, y, r);
		const left = at.x - MARK_SIZE / 2;
		ctx.fillStyle = theme.needsPerson;
		ctx.beginPath();
		ctx.roundRect(left, at.y - MARK_SIZE / 2, w, MARK_SIZE, MARK_SIZE / 2);
		ctx.fill();
		ctx.fillStyle = theme.surface;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, left + w / 2, at.y + 0.5);
	};

	/** An up-next number, 1 to 3, in the order the agents pick the items up: a circle of surface edged in Ready's blue. */
	const drawNumber = (x: number, y: number, number: number): void => {
		disc(x, y, MARK_SIZE / 2, theme.surface);
		ring(x, y, MARK_SIZE / 2 - 0.75, theme.status.ready, 1.5);
		ctx.fillStyle = theme.text;
		ctx.font = `700 ${MARK_FONT}px ${theme.font}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(number), x, y + 0.5);
	};

	const drawUpNext = (x: number, y: number, r: number, number: number): void => {
		const at = markAt(x, y, r);
		drawNumber(at.x, at.y, number);
	};

	const drawRollupBar = (x: number, y: number, w: number, h: number, segments: ReadonlyArray<{ phase: MapPhase; x: number; w: number }>): void => {
		ctx.fillStyle = theme.border;
		ctx.fillRect(x, y, w, h);
		for (const segment of segments) {
			ctx.fillStyle = theme.phase[segment.phase];
			ctx.fillRect(segment.x, y, segment.w, h);
		}
	};

	/** `lift` is how far the dot has grown into the focused one, 0 to 1; `offset` is how far a drag has pulled it, in layout units. */
	const drawDot = (dot: DrawDot, transform: Transform, level: ZoomLevel, alpha: number, lift = 0, offset: { dx: number; dy: number } | null = null): void => {
		const r = screenRadius(dot, transform.k, level) * (1 + FOCUS_GROW * lift);
		const x = transform.x + transform.k * (dot.x + (offset?.dx ?? 0));
		const y = transform.y + transform.k * (dot.y + (offset?.dy ?? 0));
		const ringed = dot.reason !== null;
		const focusAt = r + (ringed ? INK_GAP + INK_WIDTH + FOCUS_GAP : FOCUS_GAP) + FOCUS_WIDTH / 2;
		if (offscreen(x, y, focusAt + FOCUS_WIDTH + markExtra(dot, level))) return;
		if (dot.live) drawGlow(x, y, r, alpha);
		ctx.globalAlpha = alpha;
		disc(x, y, lift > 0 ? focusAt + FOCUS_WIDTH : r + (ringed ? INK_GAP + INK_WIDTH + 0.5 : BACKING), theme.surface);
		if (ringed) ring(x, y, r + INK_GAP + INK_WIDTH / 2, theme.needsPerson, INK_WIDTH);
		if (lift > 0) {
			ctx.globalAlpha = alpha * lift;
			ring(x, y, focusAt, theme.text, FOCUS_WIDTH);
			ctx.globalAlpha = alpha;
		}
		// A finished family (the parent and everything under it done) is one done dot with its count inside;
		// any other folded family keeps its own glyph and carries its rollup under it.
		const finished = dot.folded !== null && dot.status === 'done' && dot.folded.rollup.done === dot.folded.count - 1;
		const count = finished && r >= COUNT_MIN_RADIUS ? dot.folded!.count : null;
		drawGlyph(x, y, r, dot.status, { weight: dot.weight, cue: dot.cue, count });
		if (dot.pr) drawPrMark(x, y, r);
		if (dot.upNext !== null) drawUpNext(x, y, r, dot.upNext);
		else if (dot.reason !== null && level !== 'far') drawReasonTag(x, y, r, REASON_TAGS[dot.reason]);
		if (dot.folded && !finished && r >= COUNT_MIN_RADIUS) {
			const w = Math.max(16, 1.6 * r);
			drawRollupBar(x - w / 2, y + r + 4, w, 3, rollupSegments(dot.folded.rollup, x - w / 2, w));
		}
		ctx.globalAlpha = 1;
	};

	/** A live session's still glow: amber fading out from the mark's edge. No animation, at rest or otherwise. */
	const drawGlow = (x: number, y: number, r: number, alpha: number): void => {
		const { r: red, g, b } = theme.agentRgb;
		const gradient = ctx.createRadialGradient(x, y, r * 0.5, x, y, r + GLOW_REACH);
		gradient.addColorStop(0, `rgba(${red}, ${g}, ${b}, ${GLOW_STRENGTH})`);
		gradient.addColorStop(1, `rgba(${red}, ${g}, ${b}, 0)`);
		ctx.globalAlpha = alpha;
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x, y, r + GLOW_REACH, 0, 2 * Math.PI);
		ctx.fill();
		ctx.globalAlpha = 1;
	};

	/** A computer: a laptop in a rounded square. A session: its number in a disc, hollow while quiet. `lift` is how far it has grown into the focused mark. */
	const drawAgent = (agent: DrawAgent, transform: Transform, level: ZoomLevel, alpha: number, lift: number): void => {
		const r = agentRadius(agent, transform.k, level) * (1 + FOCUS_GROW * lift);
		const x = transform.x + transform.k * agent.x;
		const y = transform.y + transform.k * agent.y;
		const focusAt = r + FOCUS_GAP + FOCUS_WIDTH / 2;
		if (offscreen(x, y, focusAt + FOCUS_WIDTH + GLOW_REACH)) return;
		const live = agent.state === 'live';
		if (live && agent.kind === 'session') drawGlow(x, y, r, alpha);
		ctx.globalAlpha = alpha;
		const ink = live ? theme.machine : theme.muted;
		if (agent.kind === 'computer') {
			const side = 2 * r;
			ctx.fillStyle = theme.surface;
			ctx.beginPath();
			ctx.roundRect(x - r - BACKING, y - r - BACKING, side + 2 * BACKING, side + 2 * BACKING, side * 0.32 + BACKING);
			ctx.fill();
			ctx.strokeStyle = ink;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.roundRect(x - r + 1, y - r + 1, side - 2, side - 2, side * 0.32);
			ctx.stroke();
			ctx.save();
			ctx.translate(x, y);
			ctx.scale((side * 0.62) / LAPTOP_BOX, (side * 0.62) / LAPTOP_BOX);
			ctx.translate(-LAPTOP_BOX / 2, -LAPTOP_BOX / 2);
			ctx.lineWidth = 1.7;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke(laptop);
			ctx.restore();
		} else {
			disc(x, y, r + BACKING, theme.surface);
			if (live) disc(x, y, r, ink);
			else ring(x, y, r - 0.75, ink, 1.5);
			ctx.fillStyle = live ? theme.surface : ink;
			ctx.font = `700 ${Math.max(9, Math.min(13, Math.round(r * 1.1)))}px ${theme.font}`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(agent.number), x, y + 0.5);
		}
		if (lift > 0) {
			ctx.globalAlpha = alpha * lift;
			if (agent.kind === 'computer') {
				ctx.strokeStyle = theme.text;
				ctx.lineWidth = FOCUS_WIDTH;
				ctx.beginPath();
				ctx.roundRect(x - r - FOCUS_GAP, y - r - FOCUS_GAP, 2 * (r + FOCUS_GAP), 2 * (r + FOCUS_GAP), r * 0.64 + FOCUS_GAP);
				ctx.stroke();
			} else {
				ring(x, y, focusAt, theme.text, FOCUS_WIDTH);
			}
		}
		ctx.globalAlpha = 1;
	};

	const drawRegions = (regions: readonly RegionOutline[], transform: Transform, focus: FocusFrame, outlined: ReadonlySet<string>): void => {
		const { k } = transform;
		for (const outline of regions) {
			const { bounds } = outline;
			if (transform.x + k * bounds.maxX < 0 || transform.x + k * bounds.minX > width) continue;
			if (transform.y + k * bounds.maxY < 0 || transform.y + k * bounds.minY > plotHeight()) continue;
			let path = outlines.get(outline);
			if (!path) {
				path = outlinePath(outline);
				outlines.set(outline, path);
			}
			const strength = regionStrength(focus, outline.key, theme.fade);
			const dark = outlined.has(outline.key) ? 1 : darkness(focus, outline.key);
			ctx.save();
			ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * transform.x, ratio * transform.y);
			ctx.globalAlpha = strength;
			ctx.fillStyle = theme.regionFill[Math.min(REGION_TINT_LEVELS, outline.height) - 1]!;
			ctx.fill(path);
			ctx.strokeStyle = theme.regionStroke;
			ctx.lineWidth = 1 / k;
			ctx.stroke(path);
			if (dark > 0) {
				ctx.globalAlpha = strength * dark;
				ctx.strokeStyle = theme.regionStrokeFocus;
				ctx.lineWidth = 2 / k;
				ctx.stroke(path);
			}
			ctx.restore();
		}
	};

	const drawLinks = (links: readonly DrawLink[], all: boolean, transform: Transform, focus: FocusFrame): void => {
		const screen = (p: { x: number; y: number }): { x: number; y: number } => ({ x: transform.x + transform.k * p.x, y: transform.y + transform.k * p.y });
		// Satisfied links first, so an open one crossing them stays on top.
		for (const satisfied of [true, false]) {
			for (const link of links) {
				if (link.satisfied !== satisfied) continue;
				const strength = linkStrength(focus, link, all, theme.fade);
				if (strength <= 0.01) continue;
				const curve = linkCurve(link.kind, screen(link.from), screen(link.to));
				// A curve stays inside the hull of its control points, so it's off screen only when they all are, past one edge.
				const hull = curve.type === 'cubic' ? [curve.from, curve.c1, curve.c2, curve.to] : [curve.from, curve.c, curve.to];
				if (hull.every((p) => p.x < 0) || hull.every((p) => p.x > width) || hull.every((p) => p.y < 0) || hull.every((p) => p.y > plotHeight())) continue;
				const lit = focus.to?.links.has(link.id) ?? false;
				ctx.globalAlpha = strength;
				if (link.kind === 'agent') {
					// An amber line from a live session; a quiet one is dashed and muted, so it never leans on hue alone.
					ctx.strokeStyle = link.live ? theme.agent : theme.link;
					ctx.lineWidth = link.live ? 2 : 1.5;
					ctx.setLineDash(link.live ? [] : QUIET_DASH);
				} else {
					ctx.strokeStyle = lit && !link.satisfied ? theme.text : link.satisfied ? theme.linkSatisfied : theme.link;
					ctx.lineWidth = lit ? 1.5 : 1;
					ctx.setLineDash(link.kind === 'discovered' ? DISCOVERED_DASH : []);
				}
				ctx.beginPath();
				ctx.moveTo(curve.from.x, curve.from.y);
				if (curve.type === 'cubic') ctx.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.to.x, curve.to.y);
				else ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.to.x, curve.to.y);
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
		ctx.setLineDash([]);
	};

	const drawControl = (at: Circle, collapse: boolean, alpha: number): void => {
		ctx.globalAlpha = alpha;
		disc(at.x, at.y, at.r, theme.surface);
		ring(at.x, at.y, at.r - 0.5, theme.muted, 1);
		ctx.strokeStyle = theme.text;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		const arm = at.r * 0.5;
		ctx.moveTo(at.x - arm, at.y);
		ctx.lineTo(at.x + arm, at.y);
		if (!collapse) {
			ctx.moveTo(at.x, at.y - arm);
			ctx.lineTo(at.x, at.y + arm);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	};

	const drawLabels = (labels: readonly RegionLabel[], focus: FocusFrame, ringed: string | null): void => {
		for (const label of labels) {
			const { box, glyph, region } = label;
			ctx.globalAlpha = label.alpha * regionStrength(focus, label.key, theme.fade);
			if (label.key === ringed) {
				// A gap of surface, then ink, outside the pill: the dot's focus ring in a pill's shape.
				const gap = FOCUS_GAP + FOCUS_WIDTH / 2;
				ctx.beginPath();
				ctx.roundRect(box.x - gap, box.y - gap, box.w + 2 * gap, box.h + 2 * gap, box.h / 2 + gap);
				ctx.strokeStyle = theme.surface;
				ctx.lineWidth = FOCUS_WIDTH + 2 * FOCUS_GAP;
				ctx.stroke();
				ctx.strokeStyle = theme.text;
				ctx.lineWidth = FOCUS_WIDTH;
				ctx.stroke();
			}
			ctx.fillStyle = theme.surface;
			ctx.beginPath();
			ctx.roundRect(box.x, box.y, box.w, box.h, box.h / 2);
			ctx.fill();
			if (region.reason !== null) {
				disc(glyph.x, glyph.y, glyph.r + INK_GAP + INK_WIDTH + 0.5, theme.surface);
				ring(glyph.x, glyph.y, glyph.r + INK_GAP + INK_WIDTH / 2, theme.needsPerson, INK_WIDTH);
			}
			// The label's glyph keeps its size, so the title stays legible, but takes the parent's ring weight, tint, and cues.
			drawGlyph(glyph.x, glyph.y, glyph.r, region.status, { weight: region.weight, cue: region.cue });
			if (region.pr) drawPrMark(glyph.x, glyph.y, glyph.r);
			if (label.badge && region.upNext !== null) drawNumber(label.badge.x, label.badge.y, region.upNext);
			ctx.fillStyle = theme.text;
			ctx.font = fontOf('region');
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			ctx.fillText(label.title, label.titleAt.x, label.titleAt.y + 0.5);
			drawRollupBar(label.bar.x, label.bar.y, label.bar.w, label.bar.h, label.segments);
		}
		ctx.globalAlpha = 1;
	};

	const drawDotLabels = (labels: readonly DotLabel[], focus: FocusFrame, dragged: string | null): void => {
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		ctx.lineWidth = HALO_WIDTH;
		ctx.strokeStyle = theme.surface;
		for (const label of labels) {
			// A label stays behind where its dot was, so a dragged dot goes without one.
			if (label.key === dragged) continue;
			const { box } = label;
			const x = box.x + DOT_LABEL_PAD;
			const y = box.y + box.h / 2 + 0.5;
			ctx.globalAlpha = label.alpha * dotStrength(focus, label.key, theme.fade);
			ctx.font = fontOf(label.strong ? 'dot-strong' : 'dot');
			ctx.strokeText(label.text, x, y);
			ctx.fillStyle = label.strong ? theme.text : theme.labelInk;
			ctx.fillText(label.text, x, y);
		}
		ctx.globalAlpha = 1;
	};

	const drawBlocks = (blocks: readonly PlacedBlock[], focus: FocusFrame): void => {
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		ctx.lineWidth = HALO_WIDTH;
		ctx.strokeStyle = theme.surface;
		for (const block of blocks) {
			ctx.globalAlpha = dotStrength(focus, block.key, theme.fade);
			block.lines.forEach((line, i) => {
				const x = block.box.x + DOT_LABEL_PAD;
				const y = block.box.y + (i + 0.5) * BLOCK_LINE_HEIGHT + 0.5;
				ctx.font = fontOf(line.strong ? 'dot-strong' : 'dot');
				ctx.strokeText(line.text, x, y);
				ctx.fillStyle = line.strong ? theme.text : theme.labelInk;
				ctx.fillText(line.text, x, y);
			});
		}
		ctx.globalAlpha = 1;
	};

	const drawRuler = (ruler: RulerMarks | null): void => {
		const top = plotHeight();
		ctx.strokeStyle = theme.border;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, top + 0.5);
		ctx.lineTo(width, top + 0.5);
		ctx.stroke();
		if (!ruler) return;

		ctx.fillStyle = theme.muted;
		ctx.font = `${LABEL_SIZE}px ${theme.font}`;
		ctx.textBaseline = 'top';
		ctx.textAlign = 'center';
		ctx.beginPath();
		for (const tick of ruler.ticks) {
			ctx.moveTo(tick.x + 0.5, top);
			ctx.lineTo(tick.x + 0.5, top + TICK_LENGTH);
			ctx.fillText(tick.label, tick.x, top + TICK_LENGTH + 4);
		}
		ctx.strokeStyle = theme.muted;
		ctx.stroke();
		if (ruler.quiet) {
			ctx.textAlign = 'left';
			ctx.fillText(ruler.quiet.label, ruler.quiet.x + 6, top + TICK_LENGTH + 4);
		}
	};

	const drawEdgeLine = (ruler: RulerMarks): void => {
		const { x } = ruler.edge;
		if (x < 0 || x > width) return;
		ctx.save();
		ctx.globalAlpha = 0.6;
		ctx.strokeStyle = theme.muted;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x + 0.5, 0);
		ctx.lineTo(x + 0.5, plotHeight());
		ctx.stroke();
		ctx.restore();
	};

	// After the dots, so a dot near the edge can't paint over the label.
	const drawEdgeLabel = (ruler: RulerMarks): void => {
		const { x, label } = ruler.edge;
		ctx.font = fontOf('dot-strong');
		const at = edgeLabelAt(x, ctx.measureText(label).width, width);
		if (!at) return;
		ctx.fillStyle = theme.muted;
		ctx.textBaseline = 'top';
		ctx.textAlign = at.align;
		// A halo of the surface color keeps the label legible over a dot.
		ctx.lineJoin = 'round';
		ctx.lineWidth = 3;
		ctx.strokeStyle = theme.surface;
		ctx.strokeText(label, at.anchor, EDGE_LABEL_TOP);
		ctx.fillText(label, at.anchor, EDGE_LABEL_TOP);
	};

	return {
		resize(nextWidth, nextHeight) {
			width = nextWidth;
			height = nextHeight;
			fit();
		},
		refreshTheme() {
			theme = readTheme(canvas, normalize, forcedColors?.matches ?? false);
			tints.clear();
			widths.clear();
		},
		measureLabel(text, font) {
			const key = `${font}:${text}`;
			let measured = widths.get(key);
			if (measured === undefined) {
				ctx.font = fontOf(font);
				measured = ctx.measureText(text).width;
				widths.set(key, measured);
			}
			return measured;
		},
		draw({ dots, regions, links, allLinks, labels, dotLabels, agents, blocks, controls, cards, focus, outlined, ringed, drag, transform, level, ruler }) {
			if (width === 0 || height === 0) return;
			if ((window.devicePixelRatio || 1) !== ratio) fit();
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			ctx.fillStyle = theme.surface;
			ctx.fillRect(0, 0, width, height);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, plotHeight());
			ctx.clip();
			drawRegions(regions, transform, focus, outlined);
			if (ruler) drawEdgeLine(ruler);
			drawLinks(links, allLinks, transform, focus);
			let pulled: DrawDot | null = null;
			for (const dot of dots) {
				if (dot.key === drag?.key) {
					pulled = dot;
					continue;
				}
				const alpha = cards?.keys.has(dot.key) ? 1 - cards.alpha : 1;
				if (alpha > 0) drawDot(dot, transform, level, alpha * dotStrength(focus, dot.key, theme.fade), growth(focus, dot.key));
			}
			// On top and at full strength: it is what the person has hold of.
			if (pulled) drawDot(pulled, transform, level, cards?.keys.has(pulled.key) ? 1 - cards.alpha : 1, 1, drag);
			for (const agent of agents) drawAgent(agent, transform, level, dotStrength(focus, agent.key, theme.fade), growth(focus, agent.key));
			drawLabels(labels, focus, ringed);
			drawDotLabels(dotLabels, focus, drag?.key ?? null);
			drawBlocks(blocks, focus);
			for (const control of controls) {
				const strength = control.collapse ? regionStrength(focus, control.key, theme.fade) : dotStrength(focus, control.key, theme.fade);
				drawControl(control.at, control.collapse, control.alpha * strength);
			}
			if (ruler) drawEdgeLabel(ruler);
			ctx.restore();
			drawRuler(ruler);
		},
	};
}
