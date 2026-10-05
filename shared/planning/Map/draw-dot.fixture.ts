import type { DrawDot } from './draw-list';

/** A dot as the renderer receives it, for tests that place labels and cards without a layout. */
export const drawDot = (key: string, x: number, y: number, extra: Partial<DrawDot> = {}): DrawDot => ({
	key,
	x,
	y,
	r: 5.5,
	title: `Item ${key}`,
	flight: null,
	status: 'ready',
	weight: 1,
	needsPerson: false,
	cue: null,
	pr: false,
	live: false,
	folded: null,
	...extra,
});
