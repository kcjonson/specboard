import { cubicBezier } from './camera';
import type { DrawLink } from './draw-list';
import { linkAtRest } from './links';
import type { Relation } from './relations';

/**
 * The fade that hover, keyboard focus, and selection run (spec, Live updates and
 * motion): everything outside the related set drops to a share of its strength over
 * 150 ms, ease-out, and comes back the same way. Under reduced motion it is instant.
 */
export const FOCUS_FADE_MS = 150;

/** What unrelated marks keep: 30% on a light surface, 40% on a dark one, where less would vanish into the ground. */
export const FADE_LIGHT = 0.3;
export const FADE_DARK = 0.4;

/** CSS's `ease-out`. */
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);

/** How much the focused dot grows. */
export const FOCUS_GROW = 0.35;

/**
 * Where the fade stands: the relation it is leaving, the one it is heading to, and how
 * far along it is. A mark's strength is the blend of what it was and what it will be, so a
 * move from one dot straight to another crossfades instead of dropping to full and back.
 */
export interface FocusFrame {
	from: Relation | null;
	to: Relation | null;
	/** 0 to 1, eased; 1 when `from` no longer matters. */
	t: number;
}

export class FocusFade {
	private from: Relation | null = null;
	private to: Relation | null = null;
	private startedAt = 0;
	private t = 1;
	private readonly now: () => number;
	private readonly reducedMotion: () => boolean;

	constructor(now: () => number, reducedMotion: () => boolean) {
		this.now = now;
		this.reducedMotion = reducedMotion;
	}

	get target(): Relation | null {
		return this.to;
	}

	/** Heads for a new relation, or for none. A fade turned around halfway starts from whichever end it is nearer. */
	set(to: Relation | null): void {
		if (to === this.to) return;
		this.frame();
		if (this.t >= 0.5) this.from = this.to;
		this.to = to;
		this.startedAt = this.now();
		this.t = this.reducedMotion() ? 1 : 0;
		if (this.t === 1) this.from = null;
	}

	/** Moves the fade to this moment. */
	frame(): FocusFrame {
		if (this.t < 1) {
			const elapsed = (this.now() - this.startedAt) / FOCUS_FADE_MS;
			this.t = elapsed >= 1 ? 1 : Math.max(0, elapsed);
			if (this.t === 1) this.from = null;
		}
		return { from: this.from, to: this.to, t: this.t >= 1 ? 1 : EASE_OUT(this.t) };
	}

	/** A frame is still owed: the fade has not landed. */
	get animating(): boolean {
		return this.t < 1;
	}
}

const between = (before: number, after: number, t: number): number => before + (after - before) * t;

/** How strong a dot draws: full inside the related set, `fade` outside it, full when nothing is focused. */
export function dotStrength({ from, to, t }: FocusFrame, key: string, fade: number): number {
	const after = to === null || to.dots.has(key) ? 1 : fade;
	return t >= 1 ? after : between(from === null || from.dots.has(key) ? 1 : fade, after, t);
}

export function regionStrength({ from, to, t }: FocusFrame, key: string, fade: number): number {
	const after = to === null || to.regions.has(key) ? 1 : fade;
	return t >= 1 ? after : between(from === null || from.regions.has(key) ? 1 : fade, after, t);
}

/**
 * A link's strength under one relation. A link that doesn't draw at rest draws only when
 * the relation lights it, so it fades in with focus and out again; one that does draw stays
 * full while it lies inside the related set and fades when it leaves it.
 */
function linkUnder(relation: Relation | null, link: DrawLink, all: boolean, fade: number): number {
	const rest = linkAtRest(link.kind, all);
	if (relation === null) return rest ? 1 : 0;
	if (relation.links.has(link.id)) return 1;
	if (!rest) return 0;
	return relation.dots.has(link.ends[0]) && relation.dots.has(link.ends[1]) ? 1 : fade;
}

export function linkStrength({ from, to, t }: FocusFrame, link: DrawLink, all: boolean, fade: number): number {
	const after = linkUnder(to, link, all, fade);
	return t >= 1 ? after : between(linkUnder(from, link, all, fade), after, t);
}

/** 0 to 1: how far a dot has grown into the focused dot. */
export function growth({ from, to, t }: FocusFrame, key: string): number {
	const after = to !== null && !to.region && to.key === key ? 1 : 0;
	return t >= 1 ? after : between(from !== null && !from.region && from.key === key ? 1 : 0, after, t);
}

/** 0 to 1: how dark a region's outline has gone. */
export function darkness({ from, to, t }: FocusFrame, key: string): number {
	const after = to?.outline === key ? 1 : 0;
	return t >= 1 ? after : between(from?.outline === key ? 1 : 0, after, t);
}
