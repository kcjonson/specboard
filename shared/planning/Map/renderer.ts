import type { MapItemStatus } from '@specboard/core/map-read';
import { DONE_DISC, GLYPH_BOX, NEEDS_PERSON_TOKEN, PAUSE_BARS, RING_WIDTH, STATUS_GLYPHS, STATUS_TOKENS } from '@specboard/ui';
import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { CollapseControl } from './collapse-controls';
import { contrastFloor, formatColor, mix, parseColor, type Rgb } from './color';
import type { DrawDot, DrawLink } from './draw-list';
import type { MapPhase } from './layout/types';
import { linkCurve, linkShows, type LinkLighting } from './links';
import { ringScale, tintAmount } from './plan-weight';
import type { Circle, RegionLabel } from './region-labels';
import type { RegionOutline } from './regions/outline';
import type { RulerMarks } from './ruler';

/** Height of the ruler band along the bottom of the canvas, in CSS pixels. */
export const RULER_HEIGHT = 32;

/** What one repaint draws. The renderer takes this and nothing else, so tests and later layers can build frames freely. */
export interface MapFrame {
	dots: readonly DrawDot[];
	/** Outer regions first, so nested ones draw over them. */
	regions: readonly RegionOutline[];
	links: readonly DrawLink[];
	lighting: LinkLighting;
	labels: readonly RegionLabel[];
	controls: readonly CollapseControl[];
	transform: Transform;
	/** Null until the layout settles: only the ruler's frame draws. */
	ruler: RulerMarks | null;
}

export interface MapRenderer {
	/** The canvas's CSS size, ruler band included. */
	resize(width: number, height: number): void;
	/** Reads the theme tokens again, for a light/dark change. */
	refreshTheme(): void;
	/** A region label's title width in CSS pixels, at the label font. */
	measureLabel(text: string): number;
	draw(frame: MapFrame): void;
}

const STATUSES = Object.keys(STATUS_TOKENS) as MapItemStatus[];

/** Each nesting level out tints its region a little deeper. */
const REGION_TINT = 0.04;
const REGION_TINT_STEP = 0.025;
const REGION_TINT_LEVELS = 4;
const REGION_STROKE = 0.2;

interface MapTheme {
	surface: string;
	border: string;
	muted: string;
	text: string;
	needsPerson: string;
	font: string;
	status: Record<MapItemStatus, string>;
	/** The least of each status color a weighted mark keeps and still clears 3:1 on the surface. */
	floor: Record<MapItemStatus, number>;
	statusRgb: Record<MapItemStatus, Rgb>;
	surfaceRgb: Rgb;
	/** By height - 1, deeper for regions with more nested inside. */
	regionFill: string[];
	regionStroke: string;
	link: string;
	linkSatisfied: string;
}

/**
 * Tokens resolved against the canvas, so light and dark both come out of the same
 * names. A canvas normalizes any CSS color it's given, which is what lets the
 * contrast floor and the region tints be computed from whatever the tokens hold.
 */
function readTheme(element: Element, normalize: (color: string) => string): MapTheme {
	const style = window.getComputedStyle(element);
	const token = (name: string): string => style.getPropertyValue(name).trim();
	const rgbOf = (name: string): Rgb => {
		const rgb = parseColor(normalize(token(name)));
		if (!rgb) throw new Error(`Map theme token ${name} is not a color`);
		return rgb;
	};
	const surfaceRgb = rgbOf('--color-surface');
	const textRgb = rgbOf('--color-text');
	const mutedRgb = rgbOf('--color-text-muted');
	const status = {} as Record<MapItemStatus, string>;
	const statusRgb = {} as Record<MapItemStatus, Rgb>;
	const floor = {} as Record<MapItemStatus, number>;
	for (const key of STATUSES) {
		statusRgb[key] = rgbOf(STATUS_TOKENS[key]);
		status[key] = formatColor(statusRgb[key]);
		floor[key] = contrastFloor(statusRgb[key], surfaceRgb);
	}
	return {
		surface: formatColor(surfaceRgb),
		border: formatColor(rgbOf('--color-border')),
		muted: formatColor(mutedRgb),
		text: formatColor(textRgb),
		needsPerson: formatColor(rgbOf(NEEDS_PERSON_TOKEN)),
		font: style.fontFamily || 'sans-serif',
		status,
		floor,
		statusRgb,
		surfaceRgb,
		regionFill: Array.from({ length: REGION_TINT_LEVELS }, (_, level) =>
			formatColor(mix(textRgb, surfaceRgb, REGION_TINT + REGION_TINT_STEP * level)),
		),
		regionStroke: formatColor(mix(textRgb, surfaceRgb, REGION_STROKE)),
		link: formatColor(mix(mutedRgb, surfaceRgb, 0.85)),
		linkSatisfied: formatColor(mix(mutedRgb, surfaceRgb, 0.4)),
	};
}

/** The glyph art spans this much of its box from the center, so a dot's radius maps to it. */
const GLYPH_REACH = 7.5;

const LABEL_SIZE = 11;
const REGION_LABEL_SIZE = 12;
const TICK_LENGTH = 6;
/** Every dot sits on a disc of the surface this much wider than itself, so a region's tint never changes its contrast. */
const BACKING = 1.5;
/** The needs-a-person ring: a gap of surface, then ink. */
const INK_GAP = 2;
const INK_WIDTH = 1.5;
/** A folded dot writes its count inside once it's this big on screen. */
const COUNT_MIN_RADIUS = 8;
const SCOPING_DASH = [2.2, 1.4];
const DISCOVERED_DASH = [2, 3];

const PHASE_STATUS: Record<MapPhase, MapItemStatus> = { done: 'done', in_flight: 'in_progress', next: 'ready', later: 'blocked' };

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
	const outlines = new WeakMap<RegionOutline, Path2D>();
	const normalize = (color: string): string => {
		ctx.fillStyle = '#000000';
		ctx.fillStyle = color;
		return String(ctx.fillStyle);
	};
	let theme = readTheme(canvas, normalize);
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

	const regionFont = (): string => `600 ${REGION_LABEL_SIZE}px ${theme.font}`;

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
			ctx.fillStyle = theme.surface;
			ctx.font = `700 ${Math.min(13, Math.round(r * 0.85))}px ${theme.font}`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(count), x, y + 0.5);
		}
	};

	const drawRollupBar = (x: number, y: number, w: number, h: number, segments: ReadonlyArray<{ phase: MapPhase; x: number; w: number }>): void => {
		ctx.fillStyle = theme.border;
		ctx.fillRect(x, y, w, h);
		for (const segment of segments) {
			ctx.fillStyle = theme.status[PHASE_STATUS[segment.phase]];
			ctx.fillRect(segment.x, y, segment.w, h);
		}
	};

	const drawDot = (dot: DrawDot, transform: Transform): void => {
		const r = Math.max(dot.r * transform.k, MIN_DRAW_RADIUS);
		const x = transform.x + transform.k * dot.x;
		const y = transform.y + transform.k * dot.y;
		if (offscreen(x, y, r + INK_GAP + INK_WIDTH)) return;
		disc(x, y, r + (dot.needsPerson ? INK_GAP + INK_WIDTH + 0.5 : BACKING), theme.surface);
		if (dot.needsPerson) ring(x, y, r + INK_GAP + INK_WIDTH / 2, theme.needsPerson, INK_WIDTH);
		const count = dot.folded && r >= COUNT_MIN_RADIUS ? dot.folded.count : null;
		drawGlyph(x, y, r, dot.status, { weight: dot.weight, cue: dot.cue, count });
		if (dot.pr) {
			// A small diamond at the lower right: the item has a PR.
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
		}
		// Any collapsed family but a finished one (the parent and everything under it done) carries its rollup under it.
		if (dot.folded && r >= COUNT_MIN_RADIUS && !(dot.status === 'done' && dot.folded.rollup.done === dot.folded.count - 1)) {
			const { rollup } = dot.folded;
			const total = dot.folded.count - 1;
			const w = Math.max(16, 1.6 * r);
			let at = x - w / 2;
			const segments = (['done', 'in_flight', 'next', 'later'] as const)
				.filter((phase) => rollup[phase] > 0)
				.map((phase) => {
					const segment = { phase, x: at, w: (w * rollup[phase]) / total };
					at += segment.w;
					return segment;
				});
			drawRollupBar(x - w / 2, y + r + 4, w, 3, segments);
		}
	};

	const drawRegions = (regions: readonly RegionOutline[], transform: Transform): void => {
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
			ctx.save();
			ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * transform.x, ratio * transform.y);
			ctx.fillStyle = theme.regionFill[Math.min(REGION_TINT_LEVELS, outline.height) - 1]!;
			ctx.fill(path);
			ctx.strokeStyle = theme.regionStroke;
			ctx.lineWidth = 1 / k;
			ctx.stroke(path);
			ctx.restore();
		}
	};

	const drawLinks = (links: readonly DrawLink[], lighting: LinkLighting, transform: Transform): void => {
		const screen = (p: { x: number; y: number }): { x: number; y: number } => ({ x: transform.x + transform.k * p.x, y: transform.y + transform.k * p.y });
		// Satisfied links first, so an open one crossing them stays on top.
		const ordered = [...links].sort((a, b) => Number(b.satisfied) - Number(a.satisfied));
		for (const link of ordered) {
			if (!linkShows(link.kind, link.id, lighting)) continue;
			const curve = linkCurve(link.kind, screen(link.from), screen(link.to));
			// A curve stays inside the hull of its control points, so it's off screen only when they all are, past one edge.
			const hull = curve.type === 'cubic' ? [curve.from, curve.c1, curve.c2, curve.to] : [curve.from, curve.c, curve.to];
			if (hull.every((p) => p.x < 0) || hull.every((p) => p.x > width) || hull.every((p) => p.y < 0) || hull.every((p) => p.y > plotHeight())) continue;
			const lit = lighting.lit?.has(link.id) ?? false;
			ctx.strokeStyle = lit && !link.satisfied ? theme.text : link.satisfied ? theme.linkSatisfied : theme.link;
			ctx.lineWidth = lit ? 1.5 : 1;
			ctx.setLineDash(link.kind === 'discovered' ? DISCOVERED_DASH : []);
			ctx.beginPath();
			ctx.moveTo(curve.from.x, curve.from.y);
			if (curve.type === 'cubic') ctx.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.to.x, curve.to.y);
			else ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.to.x, curve.to.y);
			ctx.stroke();
		}
		ctx.setLineDash([]);
	};

	const drawControl = (at: Circle, collapse: boolean): void => {
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
	};

	const drawLabels = (labels: readonly RegionLabel[]): void => {
		for (const label of labels) {
			const { box, glyph, region } = label;
			ctx.fillStyle = theme.surface;
			ctx.beginPath();
			ctx.roundRect(box.x, box.y, box.w, box.h, box.h / 2);
			ctx.fill();
			if (region.needsPerson) {
				disc(glyph.x, glyph.y, glyph.r + INK_GAP + INK_WIDTH + 0.5, theme.surface);
				ring(glyph.x, glyph.y, glyph.r + INK_GAP + INK_WIDTH / 2, theme.needsPerson, INK_WIDTH);
			}
			drawGlyph(glyph.x, glyph.y, glyph.r, region.status);
			ctx.fillStyle = theme.text;
			ctx.font = regionFont();
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			ctx.fillText(label.title, label.titleAt.x, label.titleAt.y + 0.5);
			drawRollupBar(label.bar.x, label.bar.y, label.bar.w, label.bar.h, label.segments);
		}
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
		if (x < 0 || x > width) return;
		ctx.fillStyle = theme.muted;
		ctx.font = `600 ${LABEL_SIZE}px ${theme.font}`;
		ctx.textBaseline = 'top';
		const room = width - x > 150;
		ctx.textAlign = room ? 'left' : 'right';
		// A halo of the surface color keeps the label legible over a dot.
		ctx.lineJoin = 'round';
		ctx.lineWidth = 3;
		ctx.strokeStyle = theme.surface;
		ctx.strokeText(label, room ? x + 8 : x - 8, 10);
		ctx.fillText(label, room ? x + 8 : x - 8, 10);
	};

	return {
		resize(nextWidth, nextHeight) {
			width = nextWidth;
			height = nextHeight;
			fit();
		},
		refreshTheme() {
			theme = readTheme(canvas, normalize);
			tints.clear();
			widths.clear();
		},
		measureLabel(text) {
			let measured = widths.get(text);
			if (measured === undefined) {
				ctx.font = regionFont();
				measured = ctx.measureText(text).width;
				widths.set(text, measured);
			}
			return measured;
		},
		draw({ dots, regions, links, lighting, labels, controls, transform, ruler }) {
			if (width === 0 || height === 0) return;
			if ((window.devicePixelRatio || 1) !== ratio) fit();
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			ctx.fillStyle = theme.surface;
			ctx.fillRect(0, 0, width, height);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, plotHeight());
			ctx.clip();
			if (ruler) drawEdgeLine(ruler);
			drawRegions(regions, transform);
			drawLinks(links, lighting, transform);
			for (const dot of dots) drawDot(dot, transform);
			drawLabels(labels);
			for (const control of controls) drawControl(control.at, control.collapse);
			if (ruler) drawEdgeLabel(ruler);
			ctx.restore();
			drawRuler(ruler);
		},
	};
}
