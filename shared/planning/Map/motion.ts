import type { MapItemStatus } from '@specboard/core/map-read';
import { cubicBezier } from './camera';
import type { DrawAgent, DrawDot, DrawLink, DrawList } from './draw-list';
import type { MapLayout, MapPoint } from './layout/types';
import { changedKeys, type MapUpdate } from './map-update';
import type { RegionOutline } from './regions/outline';
import { HIGHLIGHT_DURATION } from '../utils/highlight';

/**
 * How a refresh moves the Map (spec, Live updates and motion). A transition runs in
 * stages: what left fades out, then what changed moves (activity glides toward now, a
 * status sweeps to its new fill, and time drift slides everything at once inside the same
 * glide), then what arrived grows in. Each stage is skipped when it has nothing in it.
 * Nothing loops, and under reduced motion every stage is a cut and what changed carries
 * the board's 2 s highlight instead.
 */

export const EXIT_MS = 250;
export const GLIDE_MS = 700;
export const ENTER_MS = 400;
export const SWEEP_MS = 250;
export const PING_MS = 900;

/** The motion table's curve for glides, entries, and the agent's ring. */
const GLIDE = cubicBezier(0.2, 0, 0, 1);
/** CSS's `ease-out`: exits, and a status sweeping in. */
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);

/** Closer than this, in layout units, a dot hasn't moved. */
const STILL = 0.01;
/** A region whose members all moved less than this keeps its outline: a new one would draw the same. */
const OUTLINE_STILL = 0.5;
/** An exit shrinks to this share of its size as it fades. */
const EXIT_SCALE = 0.5;

/** What a frame of a transition does to one dot or agent beyond where it puts it. */
export interface DotEffect {
	/** Multiplies its strength: an exit fading out, an entry fading in. */
	alpha: number;
	/** Multiplies its radius: an entry growing in, an exit shrinking away. */
	scale: number;
	/** A status change under way: the glyph it had, and how far the new one has swept in, 0 to 1. */
	sweep: { from: MapItemStatus; progress: number } | null;
	/** An agent's write: how far its one ring has spread, 0 to 1. */
	ping: number | null;
	/** Reduced motion's stand-in for all of it: the board's brief highlight. */
	highlight: boolean;
}

/** Outlines crossfading: the old ones going, and the keys of the new ones coming in over them. */
export interface RegionFade {
	outgoing: readonly RegionOutline[];
	incoming: ReadonlySet<string>;
	/** 0 to 1, eased. */
	progress: number;
}

export interface MotionFrame {
	dots: DrawDot[];
	agents: DrawAgent[];
	links: DrawLink[];
	effects: ReadonlyMap<string, DotEffect>;
	regions: RegionFade | null;
}

interface Span {
	start: number;
	end: number;
}

interface Place extends MapPoint {
	r: number;
}

interface Track {
	from: Place;
	to: Place;
	move: Span | null;
	/** Held where it was: the dot under the pointer, until the pointer leaves it. */
	held: boolean;
	enter: { span: Span; grow: boolean } | null;
	sweep: { from: MapItemStatus; span: Span } | null;
	ping: Span | null;
	highlight: Span | null;
}

interface Exit {
	dot: DrawDot | null;
	agent: DrawAgent | null;
	/** Where it folds into: the dot of the ancestor that now draws it, if any. */
	toward: MapPoint | null;
}

/** The unseen center of the innermost region a dot is drawn in, if it is in one. */
function innermostHub(layout: MapLayout, nodes: ReadonlyMap<string, MapLayout['nodes'][number]>, key: string): MapPoint | undefined {
	let best: MapLayout['regions'][number] | undefined;
	for (const region of layout.regions) {
		if ((!best || region.depth > best.depth) && region.members.includes(key)) best = region;
	}
	return best ? nodes.get(best.key) : undefined;
}

const progress = (span: Span, now: number): number => (span.end <= span.start ? (now >= span.end ? 1 : 0) : Math.max(0, Math.min(1, (now - span.start) / (span.end - span.start))));
/** Lands exactly on `b` at the end, so a finished move draws where the layout put it. */
const lerp = (a: number, b: number, t: number): number => (t >= 1 ? b : a + (b - a) * t);
const placeOf = (dot: Place): Place => ({ x: dot.x, y: dot.y, r: dot.r });
const moved = (a: Place, b: Place): boolean => Math.abs(a.x - b.x) > STILL || Math.abs(a.y - b.y) > STILL || Math.abs(a.r - b.r) > STILL;

/** What the Map is showing when a refresh lands: every dot and agent where it is drawn, and the outlines drawn around them. */
export interface Shown {
	dots: ReadonlyMap<string, DrawDot>;
	agents: ReadonlyMap<string, DrawAgent>;
	outlines: readonly RegionOutline[];
}

export interface TransitionInput {
	now: number;
	reduced: boolean;
	from: Shown;
	to: DrawList;
	layout: MapLayout;
	/** The new outlines at the step being drawn. */
	outlines: readonly RegionOutline[];
	changes: MapUpdate;
	/** The node under the pointer, which doesn't move out from under it. */
	held: string | null;
	/** The focused or selected node, which the camera follows so it stays put on screen; ignored while something is held. */
	follow: string | null;
}

/**
 * One refresh's motion, from what the Map showed to the new layout. Built once when the
 * update lands; each frame asks it where everything is and what effects run on it.
 */
export class Transition {
	private readonly tracks = new Map<string, Track>();
	private readonly exits = new Map<string, Exit>();
	private readonly exitSpan: Span;
	private readonly regionFade: { outgoing: readonly RegionOutline[]; incoming: ReadonlySet<string>; span: Span } | null;
	private readonly reduced: boolean;
	/** The camera's share of the followed node's glide, in layout units. */
	private follow: { dx: number; dy: number; span: Span; applied: number } | null;
	private heldKey: string | null;
	private end: number;

	constructor(input: TransitionInput) {
		const { now, reduced, from, to, layout, changes } = input;
		this.reduced = reduced;
		this.heldKey = null;

		const drawn = new Map<string, Place>();
		for (const dot of to.dots) drawn.set(dot.key, placeOf(dot));
		for (const agent of to.agents) drawn.set(agent.key, placeOf(agent));
		const nodes = new Map(layout.nodes.map((node) => [node.key, node]));

		// What left: dots and agents shown before with no place now. An item folded into an ancestor shrinks toward its dot.
		for (const [key, dot] of from.dots) {
			if (drawn.has(key)) continue;
			const holder = layout.representative[key];
			this.exits.set(key, { dot, agent: null, toward: holder && holder !== key ? (drawn.get(holder) ?? null) : null });
		}
		for (const [key, agent] of from.agents) if (!drawn.has(key)) this.exits.set(key, { dot: null, agent, toward: null });

		const before = new Map<string, Place>();
		for (const [key, dot] of from.dots) before.set(key, placeOf(dot));
		for (const [key, agent] of from.agents) before.set(key, placeOf(agent));
		const moving = [...drawn].some(([key, place]) => {
			const was = before.get(key);
			return was !== undefined && moved(was, place);
		});
		const entering = [...drawn.keys()].some((key) => !before.has(key));

		const exitEnd = reduced || this.exits.size === 0 ? now : now + EXIT_MS;
		this.exitSpan = { start: now, end: exitEnd };
		const moveSpan = { start: exitEnd, end: reduced || !moving ? exitEnd : exitEnd + GLIDE_MS };
		const enterSpan = { start: moveSpan.end, end: reduced || !entering ? moveSpan.end : moveSpan.end + ENTER_MS };
		const highlightSpan = { start: now, end: now + HIGHLIGHT_DURATION };
		const flash = reduced ? new Set([...changedKeys(changes)].map((key) => layout.representative[key] ?? key)) : new Set<string>();
		const pings = reduced ? new Set<string>() : new Set([...changes.wrote].flatMap((key) => layout.representative[key] ?? []));
		const toDots = new Map(to.dots.map((dot) => [dot.key, dot]));

		for (const [key, place] of drawn) {
			const was = before.get(key);
			const track: Track = { from: was ?? place, to: place, move: null, held: false, enter: null, sweep: null, ping: null, highlight: null };
			if (was === undefined) {
				// A new item grows out of the region it was filed in, or fades in where it is (the right edge, being new) if it has none.
				const hub = toDots.has(key) ? innermostHub(layout, nodes, key) : undefined;
				if (hub && !reduced) track.from = { x: hub.x, y: hub.y, r: place.r };
				if (!reduced) track.enter = { span: enterSpan, grow: hub !== undefined };
			} else if (moved(was, place)) {
				if (key === input.held) track.held = true;
				else track.move = moveSpan;
			}
			const old = from.dots.get(key);
			const dot = toDots.get(key);
			if (!reduced && old && dot && old.status !== dot.status) track.sweep = { from: old.status, span: { start: moveSpan.start, end: moveSpan.start + SWEEP_MS } };
			if (pings.has(key)) track.ping = { start: moveSpan.start, end: moveSpan.start + PING_MS };
			if (flash.has(key)) track.highlight = highlightSpan;
			if (track.move || track.held || track.enter || track.sweep || track.ping || track.highlight) this.tracks.set(key, track);
			if (track.held) this.heldKey = key;
		}

		const changedRegions = new Set<string>();
		for (const region of layout.regions) {
			if (region.members.some((key) => {
				const track = this.tracks.get(key);
				return track !== undefined && (track.enter !== null || Math.hypot(track.to.x - track.from.x, track.to.y - track.from.y) > OUTLINE_STILL);
			})) changedRegions.add(region.key);
		}
		const kept = new Set(input.outlines.map((outline) => outline.key));
		for (const outline of from.outlines) if (!kept.has(outline.key)) changedRegions.add(outline.key);
		for (const key of kept) if (!from.outlines.some((outline) => outline.key === key)) changedRegions.add(key);
		for (const exit of this.exits.keys()) {
			for (const region of layout.regions) if (region.key === layout.representative[exit] || region.members.includes(layout.representative[exit] ?? '')) changedRegions.add(region.key);
		}
		const fadeSpan = moving ? moveSpan : { start: now, end: Math.max(enterSpan.end, exitEnd) };
		this.regionFade = !reduced && changedRegions.size > 0
			? { outgoing: from.outlines.filter((outline) => changedRegions.has(outline.key)), incoming: changedRegions, span: fadeSpan }
			: null;

		const followed = input.follow;
		const left = followed ? before.get(followed) : undefined;
		const lands = followed ? drawn.get(followed) : undefined;
		this.follow = input.held === null && left && lands && moved(left, lands)
			? { dx: lands.x - left.x, dy: lands.y - left.y, span: moveSpan, applied: 0 }
			: null;

		this.end = Math.max(exitEnd, moveSpan.end, enterSpan.end, ...[...this.tracks.values()].flatMap((t) => [t.ping?.end ?? 0, t.sweep?.span.end ?? 0, t.highlight?.end ?? 0]));
	}

	/** The node held under the pointer, if any. */
	get held(): string | null {
		return this.heldKey;
	}

	/** Frames still change: something is under way. */
	animating(now: number): boolean {
		return now < this.end;
	}

	/** Nothing left to draw differently from the layout: done, and nothing held. */
	finished(now: number): boolean {
		return !this.animating(now) && this.heldKey === null;
	}

	/** The pointer left the held dot: it glides to its place now, or cuts there under reduced motion. */
	release(now: number): void {
		const track = this.heldKey === null ? undefined : this.tracks.get(this.heldKey);
		this.heldKey = null;
		if (!track) return;
		track.held = false;
		track.move = { start: now, end: this.reduced ? now : now + GLIDE_MS };
		this.end = Math.max(this.end, track.move.end);
	}

	/**
	 * How much more the camera has to move, in layout units, to keep the followed node
	 * where it was on screen: its glide so far, less what was already applied.
	 */
	followStep(now: number): { dx: number; dy: number } | null {
		const follow = this.follow;
		if (!follow) return null;
		const eased = GLIDE(progress(follow.span, now));
		const step = eased - follow.applied;
		follow.applied = eased;
		return step === 0 ? null : { dx: follow.dx * step, dy: follow.dy * step };
	}

	/** The person moved the camera themselves: it stops following. */
	stopFollowing(): void {
		this.follow = null;
	}

	/** Every dot, agent, and link where this moment of the transition puts it, with what runs on each. */
	frame(drawing: DrawList, now: number): MotionFrame {
		const effects = new Map<string, DotEffect>();
		/** Where tracked nodes are this frame; a node with no track is where the layout put it. */
		const places = new Map<string, MapPoint>();
		/** Arrivals whose stage hasn't come yet: nothing of theirs draws. */
		const hidden = new Set<string>();
		const exitT = EASE_OUT(progress(this.exitSpan, now));

		const at = <T extends DrawDot | DrawAgent>(item: T): T | null => {
			const track = this.tracks.get(item.key);
			if (!track) return item;
			let t = 1;
			if (track.held) t = 0;
			else if (track.move) t = GLIDE(progress(track.move, now));
			let alpha = 1;
			let scale = 1;
			if (track.enter) {
				if (now < track.enter.span.start) {
					hidden.add(item.key);
					return null;
				}
				const e = GLIDE(progress(track.enter.span, now));
				t = e;
				if (track.enter.grow) scale = e;
				else alpha = e;
			}
			const x = lerp(track.from.x, track.to.x, t);
			const y = lerp(track.from.y, track.to.y, t);
			places.set(item.key, { x, y });
			const sweep = track.sweep && now < track.sweep.span.end ? { from: track.sweep.from, progress: EASE_OUT(progress(track.sweep.span, now)) } : null;
			const ping = track.ping && now >= track.ping.start && now < track.ping.end ? GLIDE(progress(track.ping, now)) : null;
			const highlight = track.highlight !== null && now < track.highlight.end;
			if (alpha !== 1 || scale !== 1 || sweep || ping !== null || highlight) effects.set(item.key, { alpha, scale, sweep, ping, highlight });
			return { ...item, x, y, r: lerp(track.from.r, track.to.r, t) };
		};

		const dots: DrawDot[] = [];
		const agents: DrawAgent[] = [];
		for (const [key, exit] of this.exits) {
			if (exitT >= 1) break;
			const item = exit.dot ?? exit.agent!;
			const x = exit.toward ? lerp(item.x, exit.toward.x, exitT) : item.x;
			const y = exit.toward ? lerp(item.y, exit.toward.y, exitT) : item.y;
			effects.set(key, { alpha: 1 - exitT, scale: 1 - (1 - EXIT_SCALE) * exitT, sweep: null, ping: null, highlight: false });
			if (exit.dot) dots.push({ ...exit.dot, x, y });
			else agents.push({ ...exit.agent!, x, y });
		}
		for (const dot of drawing.dots) {
			const shown = at(dot);
			if (shown) dots.push(shown);
		}
		for (const agent of drawing.agents) {
			const shown = at(agent);
			if (shown) agents.push(shown);
		}
		const links: DrawLink[] = [];
		for (const link of drawing.links) {
			const [a, b] = link.ends;
			if (hidden.has(a) || hidden.has(b)) continue;
			const from = places.get(a);
			const to = places.get(b);
			links.push(from || to ? { ...link, from: from ?? link.from, to: to ?? link.to } : link);
		}
		const fade = this.regionFade;
		const regions = fade && now < fade.span.end ? { outgoing: fade.outgoing, incoming: fade.incoming, progress: GLIDE(progress(fade.span, now)) } : null;
		return { dots, agents, links, effects, regions };
	}
}
