import type { MapItemRow } from '@specboard/core/map-read';
import {
	MAX_SCALE,
	ZOOM_STEP,
	centerOf,
	centeredOn,
	constrainTransform,
	dotsVisible,
	fitScale,
	fitTransform,
	focusTransform,
	nearestDot,
	nowTransform,
	openTransform,
	type Transform,
	type Viewport,
} from './camera';
import { computerBlock } from './computer-blocks';
import { expandControls, labelControls, type CollapseControl } from './collapse-controls';
import { intersects, type Box } from './box-index';
import { cardBox } from './cards/card-culling';
import { SPRING_MS, springRemaining } from './drag';
import { agentBox, dotBox, screenRadius } from './dot-boxes';
import { EDGE_MARKER_SIZE, placeEdgeMarkers, type EdgeMarkerInput } from './edge-markers';
import { buildDrawList, presenceKey, type DrawAgent, type DrawDot, type DrawLink, type DrawList, type Rollup } from './draw-list';
import { FocusFade } from './focus-fade';
import { HitIndex, type Hit, type HitInput } from './hit-index';
import { crossFadeAll, placeLabels, type LabelInput, type PlacedLabels } from './label-placement';
import { NO_AGENTS } from './agents';
import type { MapBounds, MapLayout, MapNode, MapPoint, MapRegion } from './layout/types';
import type { MapCamera, ScreenPoint } from './map-camera';
import { inReadingOrder, litRelation, type Highlight } from './map-lens';
import { cycle, pickInDirection, type Direction, type NavTarget } from './map-nav';
import type { MapUpdate } from './map-update';
import { minimapPanel, minimapShows, minimapSize, minimapViewport, type MinimapSize } from './minimap/minimap';
import { Transition, type Shown } from './motion';
import { EMPTY_OVERLAY, type CardSet, type DragOffset, type MapOverlay, type MinimapFrame, type QuickFrame } from './overlay';
import { agentCard, agentCardHeight, itemSessions } from './quick/agent-content';
import { quickContent, quickHeight, QUICK_WIDTH } from './quick/quick-content';
import { placeQuickCard } from './quick/quick-card-placement';
import type { RegionOutline } from './regions/outline';
import { RegionOutlines, gridStep } from './regions/region-outlines';
import { RelationIndex, type Relation } from './relations';
import { RULER_HEIGHT, type MapRenderer } from './renderer';
import { edgeLabelAt, rulerMarks } from './ruler';
import { LABEL_RULES, ZoomLevels, type LevelFrame, type ZoomLevel } from './zoom-levels';

const AGENT_KEY = /^(session|computer):/;

const EMPTY_DRAWING: DrawList = { dots: [], regions: [], links: [], agents: [], working: NO_AGENTS, needs: new Map() };

/** What the pointer is over, for the cursor: a collapse or expand control, an item or region, or nothing that takes a click. */
export type PointerTarget = 'control' | 'item' | null;

export interface MapSurfaceHandlers {
	/** The plot has no dot in it, or has one again. */
	onViewportEmpty(empty: boolean): void;
	/** The person stopped panning or zooming; `key` is the item nearest the middle of the plot, if the Map has any. */
	onSettle(key: string | null): void;
	/** A click, Enter on the focused item, or the second tap asked for this item to open in the drawer. */
	onOpen(key: string): void;
	/** A collapse or expand control was hit. */
	onCollapse(key: string, collapse: boolean): void;
	/** The zoom moved the region outlines to another grid step, which the next layout should be traced at. */
	onOutlineStep(step: number): void;
	/** The cursor's target changed. */
	onPointerTarget(target: PointerTarget): void;
	/** Keyboard focus moved to another item, region, or session, or off all of them (null): what the accessible tree's active descendant follows. */
	onFocus(key: string | null): void;
}

export interface MapSurfaceDeps {
	renderer: MapRenderer;
	camera: MapCamera;
	/** Receives what draws as DOM over the canvas: near-level cards, the quick card, and the minimap. */
	overlay: MapOverlay;
	/** The clock label fades run on, in ms. */
	now(): number;
	/** Level switches, focus fades, and a dragged dot's return cut instead of running. */
	reducedMotion(): boolean;
	/** Runs a repaint on the next frame. Only ever called when something changed. */
	schedule(paint: () => void): void;
	/** Runs a task once the current gesture's frames have gone by: outlines for a new zoom, the quick card's opening, and hover after a pan are computed there. */
	defer(task: () => void): void;
	timeZone?: string;
}

/** After the camera last moved, hover waits this long before it hit-tests: a pan or zoom under way is not a place to relight. */
export const GESTURE_QUIET_MS = 120;

/** Selecting an item pans only as far as keeps it this far inside the part of the plot the drawer leaves. */
const REVEAL_MARGIN = 56;

interface Drag {
	key: string;
	origin: ScreenPoint;
	dx: number;
	dy: number;
	/** Set on release: when it let go and how far from home it was. */
	release: { at: number; dx: number; dy: number } | null;
}

/**
 * Everything between the data and the pixels: the draw list, region outlines and
 * labels, the collapse controls, the camera's targets, the ruler, hit testing, what
 * hover, focus, and selection light, a dragged dot, and when to repaint. The renderer
 * and camera come in through their interfaces, so this is the part a test drives.
 */
export class MapSurface {
	private readonly renderer: MapRenderer;
	private readonly camera: MapCamera;
	private readonly schedule: (paint: () => void) => void;
	private readonly defer: (task: () => void) => void;
	private readonly handlers: MapSurfaceHandlers;
	private readonly timeZone: string | undefined;
	private readonly overlay: MapOverlay;
	private readonly levels: ZoomLevels;
	private readonly fade: FocusFade;
	private readonly clock: () => number;
	private readonly reducedMotion: () => boolean;
	private readonly unsubscribe: () => void;
	private layout: MapLayout | null = null;
	/** The layout's bounds widened to every region outline: what the camera fits and holds the Map to. */
	private extent: MapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
	private rows: ReadonlyMap<string, MapItemRow> = EMPTY_OVERLAY.rows;
	private drawing: DrawList = EMPTY_DRAWING;
	private dotsByKey = new Map<string, DrawDot>();
	private agentsByKey = new Map<string, DrawAgent>();
	/** Every layout node by key, items and agents alike. */
	private nodesByKey = new Map<string, MapNode>();
	/** What time it is, in epoch ms, which decides what is live, quiet, or gone; until the page says, nothing has aged. */
	private wallNow = 0;
	private relations: RelationIndex | null = null;
	private outlines: RegionOutlines | null = null;
	/** Bumped by every frame and every new layout, so only the last frame's deferred outline task runs. */
	private deferred = 0;
	private allLinks = false;
	/** What a search or filter lights; null when none is on or nothing matched, so nothing dims. */
	private highlight: Highlight | null = null;
	/** What the changes view says about each changed item on its card, by item key; null when the view is closed. */
	private changeNotes: ReadonlyMap<string, readonly string[]> | null = null;
	/** The relation the fade is heading to, kept while neither it nor the highlight changes, so the fade doesn't restart. */
	private lit: { relation: Relation | null; highlight: Highlight | null; result: Relation | null } | null = null;
	/** Markers asked for at the plot's edge, which show for the ones that are out of view. */
	private edgeMarkers: readonly EdgeMarkerInput[] = [];
	private controls: CollapseControl[] = [];
	private viewport: Viewport = { width: 0, height: 0 };
	private painting = false;
	private viewportEmpty = false;
	/** Nobody has panned or zoomed yet, so a resize reopens the default view instead of holding the old center. */
	private pristine = true;
	private pointer: ScreenPoint | null = null;
	private pointerCoarse = false;
	private minimapOn = false;
	private cards: CardSet | null = null;
	/** How opaque the cards were on the last frame, and what they were when the fade now running began, so a fade turned around halfway goes back from where it was. */
	private cardAlpha = 0;
	private cardFadeFrom = 0;
	/** Boxes over the plot that belong to the page's own controls, which cards and labels keep out from under. */
	private chrome: readonly Box[] = [];
	/** How much of the plot's right side the drawer covers, in px. */
	private covered = 0;
	/** Torn down: a frame already queued paints nothing and queues no more. */
	private disposed = false;

	/** What the pointer is over; hover lights it. */
	private hover: Hit | null = null;
	/** Hover opens the quick card after a beat, so sweeping across dots doesn't open a card on each. */
	private hoverCardReady = false;
	private hoverToken = 0;
	/** Keyboard focus: a key the keyboard layer sets. */
	private focusKey: string | null = null;
	private selected: string | null = null;
	/** The item the drawer shows, which needs no card beside it. */
	private drawerKey: string | null = null;
	/** The last frame's marks, which the hit index is built from when something asks. */
	private snapshot: HitInput | null = null;
	private hitIndex: HitIndex | null = null;
	private lastCameraChange = -Infinity;
	private rehoverPending = false;
	private drag: Drag | null = null;
	/** A refresh's motion under way, from what the Map showed to the layout it now has. */
	private transition: Transition | null = null;
	/** The camera is moving itself to keep a moved dot put on screen. */
	private following = false;
	/** The outline step the last frame drew at, which the worker traces with the next layout. */
	private step = 0;
	/** Dots by key where the last frame drew them, mid-glide included: what the quick card sits beside. */
	private framed: ReadonlyMap<string, DrawDot> = new Map();

	constructor(deps: MapSurfaceDeps, handlers: MapSurfaceHandlers) {
		this.renderer = deps.renderer;
		this.camera = deps.camera;
		this.schedule = deps.schedule;
		this.defer = deps.defer;
		this.overlay = deps.overlay;
		this.clock = deps.now;
		this.reducedMotion = deps.reducedMotion;
		this.levels = new ZoomLevels(deps.now, deps.reducedMotion);
		this.fade = new FocusFade(deps.now, deps.reducedMotion);
		this.timeZone = deps.timeZone;
		this.handlers = handlers;
		this.unsubscribe = this.camera.onChange(() => {
			// The Map's own follow of a moved dot is no gesture: hover keeps testing, and the follow goes on.
			if (!this.following) {
				this.lastCameraChange = this.clock();
				this.transition?.stopFollowing();
				this.rehoverSoon();
			}
			this.requestPaint();
		});
	}

	destroy(): void {
		this.disposed = true;
		this.unsubscribe();
		// A deferred outline task still pending finds the token moved and does nothing.
		this.deferred++;
		this.hoverToken++;
		this.outlines = null;
	}

	/** The canvas's CSS size, ruler band included. */
	resize(width: number, height: number): void {
		const before = this.layout ? centerOf(this.camera.transform, this.viewport) : null;
		this.viewport = { width, height: Math.max(0, height - RULER_HEIGHT) };
		this.renderer.resize(width, height);
		if (this.layout) {
			this.configureCamera();
			if (this.pristine || !before) this.camera.set(this.openView());
			else this.camera.set(centeredOn(before, Math.max(this.camera.transform.k, this.minScale()), this.viewport));
		}
		this.requestPaint();
	}

	refreshTheme(): void {
		this.renderer.refreshTheme();
		this.requestPaint();
	}

	/** A layout is on the Map, so a new one is an update rather than an opening. */
	get showing(): boolean {
		return this.layout !== null;
	}

	/** Draws a settled layout, opening on `focusKey` if the Map has it and on now otherwise. */
	show(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, focusKey: string | null): void {
		this.transition = null;
		this.take(layout, rows);
		this.pristine = true;
		const target = focusKey ? this.placeOf(focusKey) : undefined;
		const view = target ? focusTransform(target, this.extent, this.drawing.dots, null, this.viewport) : this.openView();
		// The Map opens at its level, with no fade from another one.
		this.levels.reset(view.k);
		this.camera.set(view);
		this.requestPaint();
	}

	/**
	 * Draws a new layout of the same Map where the camera already is: the viewport, the
	 * selection, focus, hover, collapse, and whatever the search and filters light all stay.
	 * With `changes` (a refresh) everything moves there in a transition from where it is
	 * drawn now, a glide interrupted halfway included; the dot under the pointer stays where
	 * it is until the pointer leaves it, and a focused or selected dot that moves takes the
	 * camera with it, so it stays put on screen. Without (a collapse) it cuts.
	 */
	update(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, changes: MapUpdate | null): void {
		const now = this.clock();
		const shown = changes && this.layout ? this.shownAt(now) : null;
		this.take(layout, rows);
		this.transition = null;
		if (shown && changes) {
			const outlines = this.outlines;
			const step = gridStep(this.camera.transform.k);
			const held = this.hover?.type === 'dot' || this.hover?.type === 'agent' ? this.hover.key : null;
			const focus = this.focusKey ?? this.selected;
			this.transition = new Transition({
				now,
				reduced: this.reducedMotion(),
				from: shown,
				to: this.drawing,
				layout,
				outlines: outlines && !outlines.empty ? (outlines.nearest(step) ?? outlines.at(step)) : [],
				changes,
				held,
				follow: focus && !this.hover ? (this.agentsByKey.has(focus) ? focus : (layout.representative[focus] ?? null)) : null,
			});
		}
		this.requestPaint();
	}

	/** Where the Map draws everything right now, mid-transition included, for the next transition to start from. */
	private shownAt(now: number): Shown {
		const frame = this.transition?.frame(this.drawing, now);
		const dots = frame?.dots ?? this.drawing.dots;
		const agents = frame?.agents ?? this.drawing.agents;
		const outlines = this.outlines && !this.outlines.empty ? (this.outlines.nearest(gridStep(this.camera.transform.k)) ?? []) : [];
		return { dots: new Map(dots.map((dot) => [dot.key, dot])), agents: new Map(agents.map((agent) => [agent.key, agent])), outlines };
	}

	/** Back to the ruler's frame alone: loading, an empty project, or an error. */
	clear(): void {
		this.layout = null;
		this.transition = null;
		this.rows = EMPTY_OVERLAY.rows;
		this.drawing = EMPTY_DRAWING;
		this.dotsByKey = new Map();
		this.agentsByKey = new Map();
		this.nodesByKey = new Map();
		this.relations = null;
		this.outlines = null;
		this.deferred++;
		this.controls = [];
		this.cards = null;
		this.cardAlpha = 0;
		this.snapshot = null;
		this.hitIndex = null;
		this.hover = null;
		this.hoverCardReady = false;
		this.drag = null;
		this.setFocus(null);
		this.minimapOn = false;
		this.setViewportEmpty(false);
		this.requestPaint();
	}

	/** Every blocker and discovered-from link draws, or only the ones focus lights. */
	setAllLinks(all: boolean): void {
		this.allLinks = all;
		this.requestPaint();
	}

	/** The items a search or filter lights; everything else dims as it does under focus, and nothing moves. Null puts everything back. */
	setHighlight(highlight: Highlight | null): void {
		if (highlight === this.highlight) return;
		this.highlight = highlight;
		this.refocus();
	}

	/** What the changes view says on each changed item's card: a line per change, with its time. Null when the view is closed. */
	setChangeNotes(notes: ReadonlyMap<string, readonly string[]> | null): void {
		if (notes === this.changeNotes) return;
		this.changeNotes = notes;
		this.requestPaint();
	}

	/** The items whose edge markers show while they are out of view, in priority order. */
	setEdgeMarkers(markers: readonly EdgeMarkerInput[]): void {
		this.edgeMarkers = markers;
		this.requestPaint();
	}

	/**
	 * What time it is, so sessions age: live until 15 minutes without a write, quiet until an
	 * hour, then gone, and an in-progress item whose sessions are all quiet needs a person.
	 * The layout stays as it was (a clock tick never re-lays-out the Map; the next read does),
	 * so a session that has left the cluster leaves the drawing and its items stay where they sit.
	 */
	setNow(now: number): void {
		if (now === this.wallNow) return;
		this.wallNow = now;
		if (!this.layout) return;
		const next = buildDrawList(this.layout, this.rows, now);
		if (presenceKey(next) === presenceKey(this.drawing)) return;
		this.adopt(next);
		this.refocus();
		this.requestPaint();
	}

	/** The boxes (plot pixels) the page's own controls cover, such as the toolbar: cards and labels are placed around them. */
	setChrome(boxes: readonly Box[]): void {
		this.chrome = boxes;
		this.requestPaint();
	}

	/** How much of the plot's right side the drawer overlays, which the quick card stays out of and selection pans clear of. */
	setCovered(width: number): void {
		if (width === this.covered) return;
		this.covered = width;
		this.requestPaint();
	}

	/** The item the drawer is showing, or null when it is closed. */
	setDrawer(key: string | null): void {
		this.drawerKey = key;
		this.requestPaint();
	}

	fitAll(): void {
		if (!this.layout) return;
		this.camera.flyTo(fitTransform(this.extent, this.viewport));
	}

	now(): void {
		if (!this.layout) return;
		this.camera.flyTo(nowTransform(this.extent, this.drawing.dots, this.viewport));
	}

	/** The on-screen buttons: about the middle of the plot. */
	zoomIn(): void {
		this.camera.zoomBy(ZOOM_STEP);
	}

	zoomOut(): void {
		this.camera.zoomBy(1 / ZOOM_STEP);
	}

	/** The zoom keys: about whatever `zoomAnchor` picks. */
	zoomInByKey(): void {
		this.camera.zoomBy(ZOOM_STEP, this.zoomAnchor());
	}

	zoomOutByKey(): void {
		this.camera.zoomBy(1 / ZOOM_STEP, this.zoomAnchor());
	}

	/** `+` and `-`: about the focused dot, which stays where it is on screen, or the middle of the plot when nothing in view has focus. */
	zoomInAtFocus(): void {
		this.camera.zoomBy(ZOOM_STEP, this.focusAnchor());
	}

	zoomOutAtFocus(): void {
		this.camera.zoomBy(1 / ZOOM_STEP, this.focusAnchor());
	}

	/** What is at a point in the plot, as of the last paint. A coarse pointer's targets are at least 44 px across. */
	hitAt(point: ScreenPoint, coarse: boolean): Hit | null {
		if (!this.snapshot) return null;
		this.hitIndex ??= new HitIndex(this.snapshot);
		return this.hitIndex.at(point, coarse);
	}

	/**
	 * The pointer moved over the plot (or left it, for null). What it is over lights, once
	 * the camera has been still a moment: a pan or zoom under way is not hit-tested, and the
	 * pointer is looked at again when it ends. Nothing changes when it is over the same thing.
	 */
	hoverAt(point: ScreenPoint | null, coarse = false): void {
		this.pointer = point;
		this.pointerCoarse = coarse;
		if (!point) {
			this.setHover(null);
			return;
		}
		if (this.drag) return;
		if (this.gesturing()) {
			this.rehoverSoon();
			return;
		}
		this.setHover(this.hitAt(point, coarse));
	}

	/** A press and release in place on `hit`: a click, or a tap on a coarse pointer, where the first tap selects and shows the card and the second opens the item. */
	tap(hit: Hit | null, touch: boolean): void {
		if (!hit) {
			if (touch && this.selected !== null && this.selected !== this.drawerKey) this.select(null);
			return;
		}
		if (hit.type === 'control') {
			this.handlers.onCollapse(hit.key, hit.collapse);
			return;
		}
		// A computer or session has no drawer: a click holds it lit, with its card, and a second one lets go.
		if (hit.type === 'agent') {
			this.select(this.selected === hit.key ? null : hit.key);
			return;
		}
		if (touch && this.selected !== hit.key) {
			this.select(hit.key);
			return;
		}
		this.open(hit.key);
	}

	/** Holds an item (or a region's parent) lit, or releases the selection with null. */
	select(key: string | null): void {
		if (key === this.selected) return;
		this.selected = key;
		this.refocus();
	}

	get selection(): string | null {
		return this.selected;
	}

	/** The key the keyboard has focus on; it lights when the pointer is off everything. */
	setFocus(key: string | null): void {
		if (key !== this.focusKey) {
			this.focusKey = key;
			this.handlers.onFocus(key);
		}
		this.refocus();
	}

	get focus(): string | null {
		return this.focusKey;
	}

	/** Whether the Map draws something under this key that focus can rest on. */
	canFocus(key: string): boolean {
		return this.placeOf(key) !== undefined;
	}

	/** Enter on the focused item or region: selects it and asks for the drawer. A computer or session has no drawer, so Enter holds it lit and a second one lets go. Null when nothing has focus. */
	activateFocus(): string | null {
		const key = this.focusKey;
		if (key === null) return null;
		if (this.agentsByKey.has(key)) this.select(this.selected === key ? null : key);
		else this.open(key);
		return key;
	}

	/**
	 * An arrow key: focus goes to the nearest dot or region label in that direction, among those
	 * the last frame drew, and the Map pans just far enough to keep it in view. With nothing
	 * focused yet it lands on what is nearest the middle instead, whichever arrow it was. Stays
	 * where it is at the edge. Returns the key focus is on, or null on an empty Map.
	 */
	moveFocus(direction: Direction): string | null {
		const from = this.focusKey === null ? undefined : this.pointOf(this.focusKey);
		if (!from) return this.focusNearCenter();
		const next = pickInDirection(from, this.navTargets(), direction, this.focusKey);
		if (!next) return this.focusKey;
		this.setFocus(next.key);
		this.reveal(next.key);
		return next.key;
	}

	/** Puts focus on the dot nearest the middle of the plot, where the Map is already looking, so nothing pans. */
	focusNearCenter(): string | null {
		const dot = nearestDot(this.drawing.dots, centerOf(this.camera.transform, this.viewport));
		if (!dot) return null;
		this.setFocus(dot.key);
		return dot.key;
	}

	/** P: the next item that needs a person, in reading order, wrapping. Focus goes there and the camera flies to it. */
	stepNeedsPerson(delta: 1 | -1): string | null {
		const layout = this.layout;
		if (!layout) return null;
		const drawn = new Set<string>();
		for (const key of this.drawing.needs.keys()) {
			const node = layout.representative[key];
			if (node) drawn.add(node);
		}
		return this.stepTo(inReadingOrder([...drawn], layout), delta);
	}

	/** L: the next live agent session, in the roster's order, wrapping. */
	stepLiveSession(delta: 1 | -1): string | null {
		return this.stepTo(this.drawing.working.sessions.filter((session) => session.state === 'live').map((session) => session.node), delta);
	}

	/** Shift+Left: a region folds into its parent's dot; anything else goes up to the region it sits in. */
	collapseFocus(): void {
		const node = this.focusedNode();
		const layout = this.layout;
		if (!node || !layout) return;
		if (layout.regions.some((region) => region.key === node)) {
			this.handlers.onCollapse(node, true);
			return;
		}
		const parent = this.innermostRegion(node);
		if (!parent) return;
		this.setFocus(parent.key);
		this.reveal(parent.key);
	}

	/** Shift+Right: a folded family opens into a region; a region goes down to its first dot, leftmost first. */
	expandFocus(): void {
		const node = this.focusedNode();
		const layout = this.layout;
		if (!node || !layout) return;
		const folded = this.dotsByKey.get(node)?.folded;
		if (folded) {
			if (folded.expandable) this.handlers.onCollapse(node, false);
			return;
		}
		const region = layout.regions.find((candidate) => candidate.key === node);
		const dots = (region?.members ?? []).flatMap((member) => this.dotsByKey.get(member) ?? []);
		const first = dots.sort((a, b) => a.x - b.x || a.y - b.y)[0];
		if (!first) return;
		this.setFocus(first.key);
		this.reveal(first.key);
	}

	/** F: the focused item (or the selection) and its whole family fill the part of the plot the drawer leaves. Returns the key it fit. */
	fitFamily(): string | null {
		const key = this.focusKey ?? this.selected;
		const layout = this.layout;
		if (!key || !layout) return null;
		const node = this.agentsByKey.has(key) ? key : layout.representative[key];
		const at = node ? this.nodesByKey.get(node) : undefined;
		if (!node || !at) return null;
		const view: Viewport = { width: Math.max(1, this.viewport.width - this.covered), height: this.viewport.height };
		const region = layout.regions.find((candidate) => candidate.key === node) ?? this.innermostRegion(node);
		this.pristine = false;
		if (!region) {
			this.camera.flyTo(focusTransform(at, this.extent, this.drawing.dots, this.camera.transform, view));
			return key;
		}
		const around = (p: MapNode): MapBounds => ({ minX: p.x - p.r, maxX: p.x + p.r, minY: p.y - p.r, maxY: p.y + p.r });
		let bounds = around(at);
		for (const member of region.members) {
			const placed = this.nodesByKey.get(member);
			if (placed) bounds = unionBounds(bounds, around(placed));
		}
		for (const outline of this.outlines?.at(gridStep(0)) ?? []) if (outline.key === region.key) bounds = unionBounds(bounds, outline.bounds);
		const fit = fitTransform(bounds, view);
		const k = Math.min(fit.k, MAX_SCALE);
		this.camera.flyTo(k === fit.k ? fit : centeredOn({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, k, view));
		return key;
	}

	/** Pans just far enough to bring an item (or a region's label) inside the part of the plot the drawer leaves clear. */
	reveal(key: string): void {
		const at = this.pointOf(key);
		if (!this.layout || !at) return;
		const { k, x, y } = this.camera.transform;
		const right = Math.max(REVEAL_MARGIN, this.viewport.width - this.covered - REVEAL_MARGIN);
		const bottom = Math.max(REVEAL_MARGIN, this.viewport.height - REVEAL_MARGIN);
		const dx = at.x < REVEAL_MARGIN ? REVEAL_MARGIN - at.x : at.x > right ? right - at.x : 0;
		const dy = at.y < REVEAL_MARGIN ? REVEAL_MARGIN - at.y : at.y > bottom ? bottom - at.y : 0;
		if (dx === 0 && dy === 0) return;
		this.pristine = false;
		this.camera.flyTo(constrainTransform({ k, x: x + dx, y: y + dy }, this.extent, this.viewport));
	}

	/** A press on a dot has moved far enough to be a drag. Pulls it, and its links, along with the pointer. */
	beginDrag(key: string, point: ScreenPoint): void {
		if (!this.dotsByKey.has(key)) return;
		this.drag = { key, origin: point, dx: 0, dy: 0, release: null };
		this.setHover({ type: 'dot', key, part: 'glyph' });
		this.requestPaint();
	}

	dragTo(point: ScreenPoint): void {
		const drag = this.drag;
		if (!drag || drag.release) return;
		const { k } = this.camera.transform;
		drag.dx = (point.x - drag.origin.x) / k;
		drag.dy = (point.y - drag.origin.y) / k;
		this.requestPaint();
	}

	/** Released: the dot springs home over about 300 ms, or at once under reduced motion. Nothing is saved. */
	endDrag(): void {
		const drag = this.drag;
		if (!drag || drag.release) return;
		if (this.reducedMotion()) this.drag = null;
		else drag.release = { at: this.clock(), dx: drag.dx, dy: drag.dy };
		this.requestPaint();
	}

	get dragging(): boolean {
		return this.drag !== null;
	}

	/** Puts a layout point in the middle of the plot at the current scale: a click or drag in the minimap. */
	centerOn(point: MapPoint, fly: boolean): void {
		if (!this.layout) return;
		// The camera's own pan limit applies to gestures; a target set directly has to be held to it here.
		const view = constrainTransform(centeredOn(point, this.camera.transform.k, this.viewport), this.extent, this.viewport);
		if (fly) this.camera.flyTo(view);
		else this.camera.set(view);
		this.pristine = false;
		this.handlers.onSettle(nearestDot(this.drawing.dots, centerOf(view, this.viewport))?.key ?? null);
	}

	/** Moves to an item, with a flight unless told otherwise. False when the Map has no such item. */
	focusOn(key: string, fly = true): boolean {
		const target = this.placeOf(key);
		if (!this.layout || !target) return false;
		const view = focusTransform(target, this.extent, this.drawing.dots, fly ? this.camera.transform : null, this.viewport);
		if (fly) this.camera.flyTo(view);
		else this.camera.set(view);
		return true;
	}

	/** Flies to the dot nearest the middle of the plot and returns its key. */
	jumpToNearest(): string | null {
		const key = this.centerKey();
		if (key) this.focusOn(key);
		return key;
	}

	/** The item nearest the middle of the plot. */
	centerKey(): string | null {
		return nearestDot(this.drawing.dots, centerOf(this.camera.transform, this.viewport))?.key ?? null;
	}

	/** The camera's person-driven moves have stopped. */
	settled(): void {
		this.pristine = false;
		this.handlers.onSettle(this.centerKey());
		this.rehover();
	}

	/** Reopens the default view without a flight, as a Back to an entry with no item does. */
	reopen(): void {
		if (!this.layout) return;
		this.pristine = true;
		this.camera.set(this.openView());
	}

	paint(): void {
		this.painting = false;
		if (this.disposed) return;
		const now = this.clock();
		this.follow(now);
		const transform = this.camera.transform;
		const layout = this.layout;
		const motion = this.transition?.frame(this.drawing, now) ?? null;
		const dots = motion?.dots ?? this.drawing.dots;
		const { regions } = this.drawing;
		this.framed = motion ? new Map(dots.map((dot) => [dot.key, dot])) : this.dotsByKey;
		const pull = this.pulled();
		const settledLinks = motion?.links ?? this.drawing.links;
		const links = pull ? linksPulled(settledLinks, pull) : settledLinks;
		const outlines = this.outlinesFor(transform.k);
		const level = this.levels.frame(transform.k);
		const focus = this.fade.frame();
		const minimap = layout ? this.minimapFor(transform) : null;
		const expand = expandControls(dots, transform, this.viewport, level.level);
		const ruler = layout
			? rulerMarks({
				ticks: layout.ticks,
				edge: layout.frame.scale.edge,
				quiet: layout.quiet,
				transform,
				width: this.viewport.width,
				timeZone: this.timeZone,
			})
			: null;
		// Chrome the canvas sits under (the toolbar, a notice) and the minimap are as taken as a dot is, for cards and labels alike.
		const reserved = [...this.chrome, ...(minimap ? [minimap.panel] : [])];
		if (ruler) {
			const edge = edgeLabelAt(ruler.edge.x, this.renderer.measureLabel(ruler.edge.label, 'dot-strong'), this.viewport.width);
			if (edge) reserved.push(edge.box);
		}
		const { working } = this.drawing;
		const agents = motion?.agents ?? this.drawing.agents;
		const placed = layout
			? this.placeFor(level, {
				level: level.level,
				regions,
				outlines: new Map(outlines.map((outline) => [outline.key, outline])),
				dots,
				agents,
				blocks: working.computers.map((computer) => computerBlock(computer, level.level)),
				transform,
				viewport: this.viewport,
				measure: (text, font) => this.renderer.measureLabel(text, font),
				lit: this.highlight ?? undefined,
				occupied: { circles: expand.map((control) => control.at), boxes: reserved },
			})
			: { labels: { regions: [], dots: [], blocks: [], cards: [] }, cards: [] };
		const { labels } = placed;
		const cards = this.cardsFor(level, placed.cards, transform);
		this.controls = [...labelControls(labels.regions), ...expand];
		this.renderer.draw({
			dots,
			regions: outlines,
			links,
			allLinks: this.allLinks,
			labels: labels.regions,
			dotLabels: labels.dots,
			agents,
			blocks: labels.blocks,
			controls: this.controls,
			cards: cards.set ? { keys: cards.set.keys, alpha: cards.alpha } : null,
			focus,
			outlined: this.highlight?.outlined ?? NONE,
			ringed: this.focusKey,
			drag: pull,
			effects: motion?.effects ?? null,
			fading: motion?.regions ?? null,
			transform,
			level: level.level,
			ruler,
		});
		this.snapshot = { transform, level: level.level, dots, cards: cards.set?.dots ?? [], agents, labels: labels.regions, controls: this.controls, outlines };
		this.hitIndex = null;
		this.overlay.publish({
			transform,
			rows: this.rows,
			cards: cards.set,
			cardAlpha: cards.alpha,
			minimap: minimap?.frame ?? null,
			quick: this.quickFor(transform, level.level, labels.regions, cards.set, minimap?.panel ?? null),
			focus: this.fade.target,
			drag: pull,
			edges: layout ? this.edgesFor(transform, [...(minimap ? [minimap.panel] : []), ...labels.regions.map((label) => label.box), ...labels.dots.map((label) => label.box)]) : [],
		});
		// Empty means no glyph at the size it is drawn, and no card body, reaches the plot.
		const plot = { x: 0, y: 0, w: this.viewport.width, h: this.viewport.height };
		const glyphInView = dotsVisible(dots, transform, this.viewport, (dot) => screenRadius(dot, transform.k, level.level));
		const cardInView = cards.set?.dots.some((dot) => intersects(cardBox(dot, transform), plot)) ?? false;
		this.setViewportEmpty(dots.length > 0 && !glyphInView && !cardInView);
		// A fade or a transition has to be walked frame by frame; at rest nothing asks for another.
		if (this.transition?.finished(now)) this.transition = null;
		if (level.from !== null || this.fade.animating || this.drag?.release || this.transition?.animating(now)) this.requestPaint();
	}

	/** Moves the camera along with the focused dot's glide, before the frame reads where the camera is. */
	private follow(now: number): void {
		const transition = this.transition;
		if (!transition) return;
		// A flight the person asked for (Fit all, Now, a jump) is theirs: the camera stops following.
		if (this.camera.flying) {
			transition.stopFollowing();
			return;
		}
		const step = transition.followStep(now);
		if (!step) return;
		const { k } = this.camera.transform;
		this.following = true;
		this.camera.panBy(-step.dx * k, -step.dy * k);
		this.following = false;
	}

	/** The labels and cards at this level, and while a switch is fading, the labels of the level it came from and the cards of whichever level has them. */
	private placeFor(level: LevelFrame, input: Omit<LabelInput, 'rules'>): { labels: PlacedLabels; cards: readonly DrawDot[] } {
		const placed = placeLabels({ ...input, rules: LABEL_RULES[level.level] });
		if (level.from === null) return { labels: placed, cards: placed.cards };
		// The old level's rules, on the new level's geometry: the renderer already draws the dots at the new level's size.
		const previous = placeLabels({ ...input, rules: LABEL_RULES[level.from] });
		const boxes = (dots: readonly DrawDot[]): Box[] => dots.map((dot) => cardBox(dot, input.transform));
		const arriving = level.level === 'near' ? placed.cards : [];
		const leaving = level.from === 'near' ? previous.cards : [];
		return {
			labels: crossFadeAll(placed, previous, level.progress, { arriving: boxes(arriving), leaving: boxes(leaving) }),
			cards: level.level === 'near' ? placed.cards : level.from === 'near' ? previous.cards : [],
		};
	}

	/** The placed cards and how opaque they are: the near level has them, and a switch to or from it fades them. */
	private cardsFor(level: LevelFrame, placed: readonly DrawDot[], transform: Transform): { set: CardSet | null; alpha: number } {
		if (level.began) this.cardFadeFrom = this.cardAlpha;
		const target = level.level === 'near' ? 1 : 0;
		const alpha = level.from === null ? target : this.cardFadeFrom + (target - this.cardFadeFrom) * level.progress;
		this.cardAlpha = alpha;
		if (alpha <= 0 || placed.length === 0) {
			this.cards = null;
			return { set: null, alpha };
		}
		// Left to right, so a card that does reach under its neighbor's edge is the earlier one.
		const inView = [...placed].sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
		const previous = this.cards;
		const same = previous !== null && previous.k === transform.k && previous.dots.length === inView.length && previous.dots.every((dot, i) => dot === inView[i]);
		if (!same) this.cards = { dots: inView, keys: new Set(inView.map((dot) => dot.key)), k: transform.k };
		return { set: this.cards, alpha };
	}

	/** The minimap's panel and what it shows, or null while the camera is at (or near) fit all. */
	private minimapFor(transform: Transform): { panel: Box; frame: MinimapFrame } | null {
		this.minimapOn = this.drawing.dots.length > 0 && minimapShows(transform.k, this.minScale(), this.minimapOn);
		if (!this.minimapOn) return null;
		const bounds = this.extent;
		const size: MinimapSize = minimapSize(bounds);
		const panel = minimapPanel(size, this.viewport);
		const span = { width: this.viewport.width / transform.k, height: this.viewport.height / transform.k };
		return {
			panel,
			frame: { panel, size, bounds, viewport: minimapViewport(size, bounds, transform, this.viewport), center: centerOf(transform, this.viewport), span, dots: this.drawing.dots },
		};
	}

	private take(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>): void {
		this.layout = layout;
		this.rows = rows;
		this.nodesByKey = new Map(layout.nodes.map((node) => [node.key, node]));
		this.adopt(buildDrawList(layout, rows, this.wallNow));
		this.relations = new RelationIndex(layout, rows);
		this.outlines = new RegionOutlines(layout);
		// What fit all, Now, the opening view, and the zoom-out limit frame is the dots and the regions drawn around them, whose padding runs past the dots.
		this.extent = layout.frame.bounds;
		for (const { bounds } of this.outlines.at(gridStep(0))) this.extent = unionBounds(this.extent, bounds);
		this.deferred++;
		this.configureCamera();
		// An item a refresh took away can't keep the keyboard's focus.
		if (this.focusKey !== null && !this.placeOf(this.focusKey)) this.setFocus(null);
		this.refocus();
	}

	private adopt(drawing: DrawList): void {
		this.drawing = drawing;
		this.dotsByKey = new Map(drawing.dots.map((dot) => [dot.key, dot]));
		this.agentsByKey = new Map(drawing.agents.map((agent) => [agent.key, agent]));
		// A session or computer that has left the cluster can't stay lit or held.
		if (this.selected?.match(AGENT_KEY) && !this.agentsByKey.has(this.selected)) this.selected = null;
		if (this.hover?.type === 'agent' && !this.agentsByKey.has(this.hover.key)) this.hover = null;
		if (this.focusKey?.match(AGENT_KEY) && !this.agentsByKey.has(this.focusKey)) this.setFocus(null);
	}

	/**
	 * Outlines change only with the layout and the zoom bucket, never during a pan. The
	 * first draw of a layout computes them; after that a zoom into a new bucket draws the
	 * nearest cached outlines (they're in layout units, so they still fit) and computes
	 * the new bucket's once frames stop asking for it, which is when the gesture ends.
	 */
	private outlinesFor(k: number): RegionOutline[] {
		const outlines = this.outlines;
		if (!outlines || outlines.empty) return [];
		const step = gridStep(k);
		if (step !== this.step) {
			this.step = step;
			this.handlers.onOutlineStep(step);
		}
		const token = ++this.deferred;
		if (outlines.has(step)) return outlines.at(step);
		const cached = outlines.nearest(step);
		if (!cached) return outlines.at(step);
		this.defer(() => {
			if (token !== this.deferred) return;
			outlines.at(step);
			this.requestPaint();
		});
		return cached;
	}

	/**
	 * Where an item is on the Map: its own node, or the one that draws it. A parent with open
	 * children is a region around its family and sits at its unseen center, and the children of
	 * a collapsed family sit in their collapsed parent's dot.
	 */
	private placeOf(key: string): MapPoint | undefined {
		const layout = this.layout;
		if (!layout) return undefined;
		return this.nodesByKey.get(this.agentsByKey.has(key) ? key : (layout.representative[key] ?? ''));
	}

	/** What Z holds still: the pointer if it is over the plot, otherwise the middle (undefined). */
	private zoomAnchor(): ScreenPoint | undefined {
		return this.pointer && this.inPlot(this.pointer) ? this.pointer : undefined;
	}

	/** What `+` and `-` hold still: the focused item, if it is in view. */
	private focusAnchor(): ScreenPoint | undefined {
		const at = this.focusKey === null ? undefined : this.pointOf(this.focusKey);
		return at && this.inPlot(at) ? at : undefined;
	}

	private inPlot(point: ScreenPoint): boolean {
		return point.x >= 0 && point.x <= this.viewport.width && point.y >= 0 && point.y <= this.viewport.height;
	}

	/** Where something is in the plot now: a region's label if one is drawn (that is what the eye finds), otherwise the node that draws it. */
	private pointOf(key: string): ScreenPoint | undefined {
		const label = this.snapshot?.labels.find((candidate) => candidate.key === key);
		if (label) return { x: label.box.x + label.box.w / 2, y: label.box.y + label.box.h / 2 };
		const node = this.placeOf(key);
		if (!node) return undefined;
		const { k, x, y } = this.camera.transform;
		return { x: x + k * node.x, y: y + k * node.y };
	}

	/** What an arrow key can land on, at the positions the last frame drew: every dot, and every region label that was drawn whole. */
	private navTargets(): NavTarget[] {
		const frame = this.snapshot;
		if (!frame) return [];
		const { transform } = frame;
		const targets: NavTarget[] = frame.dots.map((dot) => ({ key: dot.key, x: transform.x + transform.k * dot.x, y: transform.y + transform.k * dot.y }));
		for (const label of frame.labels) {
			if (label.alpha >= 0.5) targets.push({ key: label.key, x: label.box.x + label.box.w / 2, y: label.box.y + label.box.h / 2 });
		}
		return targets;
	}

	/** The node that draws the focused item: the item itself, a region, a folded family's dot, or a session. */
	private focusedNode(): string | null {
		const key = this.focusKey;
		if (key === null || !this.layout) return null;
		return this.agentsByKey.has(key) ? key : (this.layout.representative[key] ?? null);
	}

	/** The deepest region that holds a dot, or null for a dot outside every region. */
	private innermostRegion(node: string): MapRegion | null {
		let best: MapRegion | null = null;
		for (const region of this.layout?.regions ?? []) {
			if (region.members.includes(node) && (!best || region.depth > best.depth)) best = region;
		}
		return best;
	}

	/** Focus goes to the next of `keys` after the one it is on, and the camera flies there. */
	private stepTo(keys: readonly string[], delta: 1 | -1): string | null {
		const key = cycle(keys, this.focusedNode(), delta);
		if (key === null) return null;
		this.setFocus(key);
		this.focusOn(key);
		return key;
	}

	private requestPaint(): void {
		if (this.painting) return;
		this.painting = true;
		this.schedule(() => this.paint());
	}

	private setViewportEmpty(empty: boolean): void {
		if (empty === this.viewportEmpty) return;
		this.viewportEmpty = empty;
		this.handlers.onViewportEmpty(empty);
	}

	private openView(): ReturnType<typeof openTransform> {
		return openTransform(this.extent, this.drawing.dots, this.viewport);
	}

	private minScale(): number {
		return fitScale(this.extent, this.viewport);
	}

	private configureCamera(): void {
		this.camera.configure(this.viewport, this.extent, this.minScale());
	}

	/** Selects, and asks for the drawer, whose item needs no card beside it. */
	private open(key: string): void {
		this.select(key);
		this.drawerKey = key;
		this.handlers.onOpen(key);
	}

	/** The camera moved lately, so what is under a still pointer is about to change and isn't worth testing yet. */
	private gesturing(): boolean {
		return this.clock() - this.lastCameraChange < GESTURE_QUIET_MS;
	}

	/** Once the camera has been still, looks at the pointer again: the dot under it may be another one now. */
	private rehoverSoon(): void {
		if (this.rehoverPending || !this.pointer) return;
		this.rehoverPending = true;
		this.defer(() => {
			this.rehoverPending = false;
			if (this.disposed) return;
			if (this.gesturing()) this.rehoverSoon();
			else this.rehover();
		});
	}

	private rehover(): void {
		if (this.pointer && !this.drag && !this.gesturing()) this.setHover(this.hitAt(this.pointer, this.pointerCoarse));
	}

	private setHover(hit: Hit | null): void {
		const before = this.hover;
		if (before?.type === hit?.type && before?.key === hit?.key) return;
		this.hover = hit;
		this.handlers.onPointerTarget(hit === null ? null : hit.type === 'control' ? 'control' : 'item');
		if (before?.key === hit?.key) return;
		// A dot a refresh moved stayed put while the pointer was on it; now it goes where it belongs.
		const transition = this.transition;
		if (transition && transition.held !== null && transition.held !== hit?.key) {
			transition.release(this.clock());
			this.requestPaint();
		}
		this.hoverCardReady = false;
		const token = ++this.hoverToken;
		if (hit) {
			this.defer(() => {
				if (token !== this.hoverToken || this.disposed) return;
				this.hoverCardReady = true;
				this.requestPaint();
			});
		}
		this.refocus();
	}

	/** The item whose family lights: whatever the pointer is on, then keyboard focus, then the selection. */
	private focused(): string | null {
		return this.hover?.key ?? this.focusKey ?? this.selected;
	}

	private refocus(): void {
		const key = this.focused();
		const relation = key && this.relations ? this.relations.relation(key) : null;
		if (!this.lit || this.lit.relation !== relation || this.lit.highlight !== this.highlight) {
			this.lit = { relation, highlight: this.highlight, result: litRelation(relation, this.highlight) };
		}
		this.fade.set(this.lit.result);
		this.requestPaint();
	}

	/** The item whose quick card is open: hover after its beat, keyboard focus, or a selection the drawer isn't already showing. Not while a dot is being pulled. */
	private cardKey(): string | null {
		if (this.drag) return null;
		if (this.hover) return this.hoverCardReady ? this.hover.key : null;
		if (this.focusKey) return this.focusKey;
		return this.selected !== null && this.selected !== this.drawerKey ? this.selected : null;
	}

	private quickFor(transform: Transform, level: ZoomLevel, regionLabels: PlacedLabels['regions'], cards: CardSet | null, minimap: Box | null): QuickFrame | null {
		const key = this.cardKey();
		const relation: Relation | null = key && this.relations ? this.relations.relation(key) : null;
		if (!key || !relation) return null;
		const reserved = [...this.chrome, ...(minimap ? [minimap] : [])];
		const plot = { x: 0, y: 0, w: Math.max(0, this.viewport.width - this.covered), h: this.viewport.height };
		const related: Box[] = [];
		for (const other of relation.dots) {
			const otherDot = other === key ? undefined : this.framed.get(other);
			if (otherDot) related.push(dotBox(otherDot, transform, level));
		}
		const agent = this.agentsByKey.get(key);
		if (agent) {
			const card = agentCard(key, this.drawing.working, this.rows, this.wallNow);
			if (!card) return null;
			const size = { w: QUICK_WIDTH, h: agentCardHeight(card) };
			return { key, ...placeQuickCard({ anchor: agentBox(agent, transform, level), related, plot, reserved, size }), progress: null, marks: { reasons: [], upNext: null, sessions: [], changes: [] }, agent: card };
		}
		const row = this.rows.get(key);
		if (!row) return null;
		const dot = this.framed.get(key);
		const label = regionLabels.find((l) => l.key === key);
		const progress = progressOf(this.drawing, key, dot);
		let anchor: Box;
		if (dot) anchor = cards?.keys.has(key) ? cardBox(dot, transform) : dotBox(dot, transform, level);
		else if (label) anchor = label.box;
		else {
			const node = this.placeOf(key);
			if (!node) return null;
			anchor = { x: transform.x + transform.k * node.x - 1, y: transform.y + transform.k * node.y - 1, w: 2, h: 2 };
		}
		const marks = { reasons: this.drawing.needs.get(key) ?? [], upNext: upNextOf(this.layout, key), sessions: itemSessions(row, this.drawing.working, this.wallNow), changes: this.changeNotes?.get(key) ?? [] };
		const size = { w: QUICK_WIDTH, h: quickHeight(quickContent(row, this.rows, progress, marks)) };
		return { key, ...placeQuickCard({ anchor, related, plot, reserved, size }), progress, marks, agent: null };
	}

	/** Markers for the asked-for items that are out of view, kept off the page's own controls, the minimap, the labels, and the drawer. */
	private edgesFor(transform: Transform, taken: readonly Box[]): ReturnType<typeof placeEdgeMarkers> {
		if (this.edgeMarkers.length === 0) return [];
		return placeEdgeMarkers(this.edgeMarkers, {
			plot: { x: 0, y: 0, w: Math.max(EDGE_MARKER_SIZE, this.viewport.width - this.covered), h: this.viewport.height },
			avoid: [...this.chrome, ...taken],
			locate: (key) => {
				const node = this.placeOf(key);
				return node ? { x: transform.x + transform.k * node.x, y: transform.y + transform.k * node.y } : undefined;
			},
		});
	}

	/** The pull on the dragged dot right now, springing back if it has been released; null once it is home. */
	private pulled(): DragOffset | null {
		const drag = this.drag;
		if (!drag) return null;
		if (!drag.release) return { key: drag.key, dx: drag.dx, dy: drag.dy };
		const t = (this.clock() - drag.release.at) / SPRING_MS;
		if (t >= 1) {
			this.drag = null;
			return null;
		}
		const left = springRemaining(t);
		return { key: drag.key, dx: drag.release.dx * left, dy: drag.release.dy * left };
	}

}

/** The links with the dragged dot's ends moved along with it; every other link is as it was. */
function linksPulled(links: readonly DrawLink[], pull: DragOffset): readonly DrawLink[] {
	const move = (p: MapPoint): MapPoint => ({ x: p.x + pull.dx, y: p.y + pull.dy });
	return links.map((link) =>
		link.ends[0] === pull.key ? { ...link, from: move(link.from) } : link.ends[1] === pull.key ? { ...link, to: move(link.to) } : link,
	);
}

const NONE: ReadonlySet<string> = new Set();

/** 1 to 3 for an item that is up next. */
const upNextOf = (layout: MapLayout | null, key: string): number | null => {
	const at = layout?.upNext.indexOf(key) ?? -1;
	return at < 0 ? null : at + 1;
};

/** A parent's items by phase, for the quick card: a region's rollup, or a folded dot's; null for an item with no family. */
function progressOf(drawing: DrawList, key: string, dot: DrawDot | undefined): Rollup | null {
	const rollup = dot?.folded?.rollup ?? drawing.regions.find((region) => region.key === key)?.rollup ?? null;
	return rollup && rollup.done + rollup.in_flight + rollup.next + rollup.later > 0 ? rollup : null;
}

const unionBounds = (a: MapBounds, b: MapBounds): MapBounds => ({
	minX: Math.min(a.minX, b.minX),
	maxX: Math.max(a.maxX, b.maxX),
	minY: Math.min(a.minY, b.minY),
	maxY: Math.max(a.maxY, b.maxY),
});
