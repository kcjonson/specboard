import type { MapItemStatus } from '@specboard/core/map-read';
import { GLYPH_BOX, RING_WIDTH, STATUS_GLYPHS, STATUS_TOKENS } from '@specboard/ui';
import { MIN_DRAW_RADIUS, type Transform } from './camera';
import type { DrawDot } from './draw-list';
import type { RulerMarks } from './ruler';

/** Height of the ruler band along the bottom of the canvas, in CSS pixels. */
export const RULER_HEIGHT = 32;

/** What one repaint draws. The renderer takes this and nothing else, so tests and later layers can build frames freely. */
export interface MapFrame {
	dots: readonly DrawDot[];
	transform: Transform;
	/** Null until the layout settles: only the ruler's frame draws. */
	ruler: RulerMarks | null;
}

export interface MapRenderer {
	/** The canvas's CSS size, ruler band included. */
	resize(width: number, height: number): void;
	/** Reads the theme tokens again, for a light/dark change. */
	refreshTheme(): void;
	draw(frame: MapFrame): void;
}

interface MapTheme {
	surface: string;
	border: string;
	muted: string;
	font: string;
	status: Record<MapItemStatus, string>;
}

/** Tokens resolved against the canvas, so light and dark both come out of the same names. */
function readTheme(element: Element): MapTheme {
	const style = window.getComputedStyle(element);
	const token = (name: string): string => style.getPropertyValue(name).trim();
	const status = {} as Record<MapItemStatus, string>;
	for (const key of Object.keys(STATUS_TOKENS) as MapItemStatus[]) status[key] = token(STATUS_TOKENS[key]);
	return {
		surface: token('--color-surface'),
		border: token('--color-border'),
		muted: token('--color-text-muted'),
		font: style.fontFamily || 'sans-serif',
		status,
	};
}

/** The glyph art spans this much of its box from the center, so a dot's radius maps to it. */
const GLYPH_REACH = 7.5;

const LABEL_SIZE = 11;
const TICK_LENGTH = 6;

interface GlyphPaths {
	stroke?: Path2D;
	fill?: Path2D;
}

function glyphPaths(): Record<MapItemStatus, GlyphPaths> {
	const paths = {} as Record<MapItemStatus, GlyphPaths>;
	for (const key of Object.keys(STATUS_GLYPHS) as MapItemStatus[]) {
		const { stroke, fill } = STATUS_GLYPHS[key];
		paths[key] = { stroke: stroke ? new Path2D(stroke) : undefined, fill: fill ? new Path2D(fill) : undefined };
	}
	return paths;
}

/** One Canvas 2D layer, sized for the device's pixel ratio and repainted only when asked. */
export function createCanvasRenderer(canvas: HTMLCanvasElement): MapRenderer {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D is not available');
	const paths = glyphPaths();
	let theme = readTheme(canvas);
	let width = 0;
	let height = 0;
	let ratio = 0;

	const fit = (): void => {
		ratio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(width * ratio));
		canvas.height = Math.max(1, Math.round(height * ratio));
	};

	const drawGlyph = (dot: DrawDot, transform: Transform): void => {
		const r = Math.max(dot.r * transform.k, MIN_DRAW_RADIUS);
		const x = transform.x + transform.k * dot.x;
		const y = transform.y + transform.k * dot.y;
		if (x + r < 0 || x - r > width || y + r < 0 || y - r > height - RULER_HEIGHT) return;
		const scale = r / GLYPH_REACH;
		const { stroke, fill } = paths[dot.status];
		const color = theme.status[dot.status];
		ctx.save();
		ctx.translate(x - (GLYPH_BOX / 2) * scale, y - (GLYPH_BOX / 2) * scale);
		ctx.scale(scale, scale);
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		// Hairlines stay a pixel wide on a small dot.
		ctx.lineWidth = Math.max(RING_WIDTH, 1 / scale);
		if (fill) ctx.fill(fill, 'evenodd');
		if (stroke) ctx.stroke(stroke);
		ctx.restore();
	};

	const drawRuler = (ruler: RulerMarks | null): void => {
		const top = height - RULER_HEIGHT;
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
		const top = height - RULER_HEIGHT;
		ctx.save();
		ctx.globalAlpha = 0.6;
		ctx.strokeStyle = theme.muted;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x + 0.5, 0);
		ctx.lineTo(x + 0.5, top);
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
			theme = readTheme(canvas);
		},
		draw({ dots, transform, ruler }) {
			if (width === 0 || height === 0) return;
			if ((window.devicePixelRatio || 1) !== ratio) fit();
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			ctx.fillStyle = theme.surface;
			ctx.fillRect(0, 0, width, height);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height - RULER_HEIGHT);
			ctx.clip();
			if (ruler) drawEdgeLine(ruler);
			for (const dot of dots) drawGlyph(dot, transform);
			if (ruler) drawEdgeLabel(ruler);
			ctx.restore();
			drawRuler(ruler);
		},
	};
}
