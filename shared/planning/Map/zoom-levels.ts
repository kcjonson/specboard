import { cubicBezier } from './camera';
import { LEAF_RADIUS } from './layout/constants';

/**
 * Semantic zoom (spec, Layout requirement 5 and What shows when): far, middle, and
 * near. A level is chosen by how big a leaf dot is on screen, not by the raw zoom
 * factor, so a 2,000-item board and a ten-item board change level when their dots
 * look the same size, which is when what they can say changes.
 *
 * Each level has an enter and an exit size a little apart. A camera hovering at one
 * boundary stays in whichever level it was in, and a flight that crosses it flips once.
 */
export type ZoomLevel = 'far' | 'middle' | 'near';

/** On-screen radius of a leaf dot, in px, at which the middle level starts, and the smaller size it ends at. */
export const MIDDLE_ENTER = 8;
export const MIDDLE_EXIT = 7;

/**
 * The near level starts here: a card (key, title, marks) needs about 130 px, and
 * dots this size sit about that far apart.
 */
export const NEAR_ENTER = 22;
export const NEAR_EXIT = 19;

/** Labels fade for the new level over the camera flight's length, on its curve. */
export const FADE_MS = 450;
const FADE_EASE = cubicBezier(0.2, 0, 0, 1);

/** Regions that get a label at the far level, largest first. */
export const FAR_REGION_LABELS = 8;

export const leafRadius = (k: number): number => LEAF_RADIUS * k;

/** The level a size lands in with no history, as when the Map first opens. */
export function levelAt(k: number): ZoomLevel {
	const r = leafRadius(k);
	return r >= NEAR_ENTER ? 'near' : r >= MIDDLE_ENTER ? 'middle' : 'far';
}

/** The level after the camera moves to scale `k`, given the level it was in. */
export function nextLevel(current: ZoomLevel, k: number): ZoomLevel {
	const r = leafRadius(k);
	if (current === 'near') return r >= NEAR_EXIT ? 'near' : r >= MIDDLE_EXIT ? 'middle' : 'far';
	if (current === 'middle') return r >= NEAR_ENTER ? 'near' : r >= MIDDLE_EXIT ? 'middle' : 'far';
	return levelAt(k);
}

/** What labels a level draws on the canvas; near has cards instead of dot labels. */
export interface LabelRules {
	/** Dots that carry a label: the in-flight ones, every dot, or none. */
	dots: 'in-flight' | 'all' | 'none';
	/** At most this many region labels; null for every region with room. */
	regions: number | null;
}

export const LABEL_RULES: Record<ZoomLevel, LabelRules> = {
	far: { dots: 'in-flight', regions: FAR_REGION_LABELS },
	middle: { dots: 'all', regions: null },
	near: { dots: 'none', regions: null },
};

/** Where a level switch is: the level before it, and how far along the fade is. */
export interface LevelFrame {
	level: ZoomLevel;
	/** The level being faded out, or null once the fade is done and nothing is animating. */
	from: ZoomLevel | null;
	/** 0 to 1 along the fade's easing; 1 when `from` is null. */
	progress: number;
}

/**
 * Follows the camera's scale from frame to frame: hysteresis between levels, and the
 * fade a switch starts. The clock and reduced motion come in as functions so a test
 * drives both.
 */
export class ZoomLevels {
	private level: ZoomLevel = 'far';
	private from: ZoomLevel | null = null;
	private startedAt = 0;
	private readonly now: () => number;
	private readonly reducedMotion: () => boolean;

	constructor(now: () => number, reducedMotion: () => boolean) {
		this.now = now;
		this.reducedMotion = reducedMotion;
	}

	/** Starts at the level a scale lands in, with no fade. */
	reset(k: number): void {
		this.level = levelAt(k);
		this.from = null;
	}

	frame(k: number): LevelFrame {
		const next = nextLevel(this.level, k);
		if (next !== this.level) {
			this.from = this.reducedMotion() ? null : this.level;
			this.startedAt = this.now();
			this.level = next;
		}
		if (this.from === null) return { level: this.level, from: null, progress: 1 };
		const elapsed = (this.now() - this.startedAt) / FADE_MS;
		if (elapsed >= 1) {
			this.from = null;
			return { level: this.level, from: null, progress: 1 };
		}
		return { level: this.level, from: this.from, progress: FADE_EASE(Math.max(0, elapsed)) };
	}
}
