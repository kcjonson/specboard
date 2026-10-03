import { MIN_DRAW_RADIUS, type Transform, type Viewport } from './camera';
import type { DrawDot } from './draw-list';
import type { MapPoint } from './layout/types';
import type { Circle, RegionLabel } from './region-labels';

/**
 * The collapse and expand controls (spec, Collapse): a minus on every region label and
 * a plus on every collapsed dot big enough to carry one. They're drawn on the canvas
 * and hit-tested here; the keyboard reaches them with the Map's focus model later.
 */
export interface CollapseControl {
	key: string;
	/** What a click does: collapse the region, or expand the dot. */
	collapse: boolean;
	at: Circle;
}

const EXPAND_RADIUS = 6;
/** A folded dot smaller than this on screen carries no plus; zooming in brings it. */
const EXPAND_MIN_DOT = 5;
/** Targets reach this far past what's drawn, so a small control is still easy to hit. */
const HIT_SLOP = 4;

export function collapseControls(labels: readonly RegionLabel[], dots: readonly DrawDot[], transform: Transform, viewport: Viewport): CollapseControl[] {
	const controls: CollapseControl[] = labels.map((label) => ({ key: label.key, collapse: true, at: label.toggle }));
	const { k } = transform;
	for (const dot of dots) {
		if (!dot.folded) continue;
		const r = Math.max(dot.r * k, MIN_DRAW_RADIUS);
		if (r < EXPAND_MIN_DOT) continue;
		const x = transform.x + k * dot.x;
		const y = transform.y + k * dot.y;
		if (x + r < 0 || x - r > viewport.width || y + r < 0 || y - r > viewport.height) continue;
		// Up and to the right, just clear of the dot and its ring.
		const reach = (r + 2 + EXPAND_RADIUS * 0.6) * Math.SQRT1_2;
		controls.push({ key: dot.key, collapse: false, at: { x: x + reach, y: y - reach, r: EXPAND_RADIUS } });
	}
	return controls;
}

/** The control under a point in the plot, the last drawn winning. */
export function controlAt(controls: readonly CollapseControl[], point: MapPoint): CollapseControl | undefined {
	for (let i = controls.length - 1; i >= 0; i--) {
		const { at } = controls[i]!;
		if (Math.hypot(point.x - at.x, point.y - at.y) <= at.r + HIT_SLOP) return controls[i];
	}
	return undefined;
}
