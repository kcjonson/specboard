import type { MapItemRow } from '@specboard/core/map-read';
import {
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
import { controlAt, expandControls, labelControls, type CollapseControl } from './collapse-controls';
import { intersects, type Box } from './box-index';
import { cardBox } from './cards/card-culling';
import { screenRadius } from './dot-boxes';
import { buildDrawList, type DrawDot, type DrawList } from './draw-list';
import { crossFadeAll, placeLabels, type LabelInput, type PlacedLabels } from './label-placement';
import type { MapLayout, MapPoint } from './layout/types';
import { NO_LIGHTING, type LinkLighting } from './links';
import type { MapCamera, ScreenPoint } from './map-camera';
import { minimapPanel, minimapShows, minimapSize, minimapViewport, type MinimapSize } from './minimap/minimap';
import { EMPTY_OVERLAY, type CardSet, type MapOverlay, type MinimapFrame } from './overlay';
import type { RegionOutline } from './regions/outline';
import { RegionOutlines, gridStep } from './regions/region-outlines';
import { RULER_HEIGHT, type MapRenderer } from './renderer';
import { edgeLabelAt, rulerMarks } from './ruler';
import { LABEL_RULES, ZoomLevels, type LevelFrame } from './zoom-levels';

export interface MapSurfaceHandlers {
	/** The plot has no dot in it, or has one again. */
	onViewportEmpty(empty: boolean): void;
	/** The person stopped panning or zooming; `key` is the item nearest the middle of the plot, if the Map has any. */
	onSettle(key: string | null): void;
}

export interface MapSurfaceDeps {
	renderer: MapRenderer;
	camera: MapCamera;
	/** Receives what draws as DOM over the canvas: near-level cards and the minimap. */
	overlay: MapOverlay;
	/** The clock label fades run on, in ms. */
	now(): number;
	/** Level switches cut instead of fading. */
	reducedMotion(): boolean;
	/** Runs a repaint on the next frame. Only ever called when something changed. */
	schedule(paint: () => void): void;
	/** Runs a task once the current gesture's frames have gone by: outlines for a new zoom are computed there. */
	defer(task: () => void): void;
	timeZone?: string;
}

/** A collapse or expand control the person hit. */
export interface CollapseRequest {
	key: string;
	collapse: boolean;
}

/**
 * Everything between the data and the pixels: the draw list, region outlines and
 * labels, the collapse controls, the camera's targets, the ruler, and when to repaint.
 * The renderer and camera come in through their interfaces, so this is the part a
 * test drives, and later layers (labels, selection) add to what `paint` draws without
 * touching the camera.
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
	private readonly unsubscribe: () => void;
	private layout: MapLayout | null = null;
	private rows: ReadonlyMap<string, MapItemRow> = EMPTY_OVERLAY.rows;
	private drawing: DrawList = { dots: [], regions: [], links: [] };
	private outlines: RegionOutlines | null = null;
	/** Bumped by every frame and every new layout, so only the last frame's deferred outline task runs. */
	private deferred = 0;
	private lighting: LinkLighting = NO_LIGHTING;
	private controls: CollapseControl[] = [];
	private viewport: Viewport = { width: 0, height: 0 };
	private painting = false;
	private viewportEmpty = false;
	/** Nobody has panned or zoomed yet, so a resize reopens the default view instead of holding the old center. */
	private pristine = true;
	private pointer: ScreenPoint | null = null;
	/** Items another layer has already named, which get no label of their own. */
	private named: ReadonlySet<string> = new Set();
	private minimapOn = false;
	private cards: CardSet | null = null;
	/** How opaque the cards were on the last frame, and what they were when the fade now running began, so a fade turned around halfway goes back from where it was. */
	private cardAlpha = 0;
	private cardFadeFrom = 0;
	/** Boxes over the plot that belong to the page's own controls, which cards and labels keep out from under. */
	private chrome: readonly Box[] = [];
	/** Torn down: a frame already queued paints nothing and queues no more. */
	private disposed = false;

	constructor(deps: MapSurfaceDeps, handlers: MapSurfaceHandlers) {
		this.renderer = deps.renderer;
		this.camera = deps.camera;
		this.schedule = deps.schedule;
		this.defer = deps.defer;
		this.overlay = deps.overlay;
		this.levels = new ZoomLevels(deps.now, deps.reducedMotion);
		this.timeZone = deps.timeZone;
		this.handlers = handlers;
		this.unsubscribe = this.camera.onChange(() => this.requestPaint());
	}

	destroy(): void {
		this.disposed = true;
		this.unsubscribe();
		// A deferred outline task still pending finds the token moved and does nothing.
		this.deferred++;
		this.outlines = null;
	}

	/** The canvas's CSS size, ruler band included. */
	resize(width: number, height: number): void {
		const before = this.layout ? centerOf(this.camera.transform, this.viewport) : null;
		this.viewport = { width, height: Math.max(0, height - RULER_HEIGHT) };
		this.renderer.resize(width, height);
		if (this.layout) {
			this.configureCamera(this.layout);
			if (this.pristine || !before) this.camera.set(this.openView(this.layout));
			else this.camera.set(centeredOn(before, Math.max(this.camera.transform.k, this.minScale(this.layout)), this.viewport));
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
		this.take(layout, rows);
		this.pristine = true;
		const target = focusKey ? this.placeOf(focusKey) : undefined;
		const view = target ? focusTransform(target, layout.frame.bounds, this.drawing.dots, null, this.viewport) : this.openView(layout);
		// The Map opens at its level, with no fade from another one.
		this.levels.reset(view.k);
		this.camera.set(view);
		this.requestPaint();
	}

	/** Draws a new layout of the same Map, a collapse or a refresh, where the camera already is. */
	update(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>): void {
		this.take(layout, rows);
		this.requestPaint();
	}

	/** Back to the ruler's frame alone: loading, an empty project, or an error. */
	clear(): void {
		this.layout = null;
		this.rows = EMPTY_OVERLAY.rows;
		this.drawing = { dots: [], regions: [], links: [] };
		this.outlines = null;
		this.deferred++;
		this.controls = [];
		this.cards = null;
		this.cardAlpha = 0;
		this.minimapOn = false;
		this.setViewportEmpty(false);
		this.requestPaint();
	}

	/** Which blocker and discovered-from links draw besides chains: all of them, or the ones focus lights. */
	setLighting(lighting: LinkLighting): void {
		this.lighting = lighting;
		this.requestPaint();
	}

	/**
	 * Item keys another layer has already named, such as a computer's text block, so an
	 * item among them carries no label of its own. Empty until sessions land.
	 */
	setNamed(keys: ReadonlySet<string>): void {
		this.named = keys;
		this.requestPaint();
	}

	/** The boxes (plot pixels) the page's own controls cover, such as the toolbar: cards and labels are placed around them. */
	setChrome(boxes: readonly Box[]): void {
		this.chrome = boxes;
		this.requestPaint();
	}

	/** The collapse or expand control under a point in the plot, as of the last paint. */
	controlAt(point: ScreenPoint): CollapseRequest | null {
		const control = controlAt(this.controls, point);
		return control ? { key: control.key, collapse: control.collapse } : null;
	}

	fitAll(): void {
		if (!this.layout) return;
		this.camera.flyTo(fitTransform(this.layout.frame.bounds, this.viewport));
	}

	now(): void {
		if (!this.layout) return;
		this.camera.flyTo(nowTransform(this.layout.frame.bounds, this.drawing.dots, this.viewport));
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

	/** Where the pointer is over the canvas, or null once it leaves. */
	setPointer(point: ScreenPoint | null): void {
		this.pointer = point;
	}

	/** Puts a layout point in the middle of the plot at the current scale: a click or drag in the minimap. */
	centerOn(point: MapPoint, fly: boolean): void {
		if (!this.layout) return;
		// The camera's own pan limit applies to gestures; a target set directly has to be held to it here.
		const view = constrainTransform(centeredOn(point, this.camera.transform.k, this.viewport), this.layout.frame.bounds, this.viewport);
		if (fly) this.camera.flyTo(view);
		else this.camera.set(view);
		this.pristine = false;
		this.handlers.onSettle(nearestDot(this.drawing.dots, centerOf(view, this.viewport))?.key ?? null);
	}

	/** Moves to an item, with a flight unless told otherwise. False when the Map has no such item. */
	focusOn(key: string, fly = true): boolean {
		const target = this.placeOf(key);
		if (!this.layout || !target) return false;
		const view = focusTransform(target, this.layout.frame.bounds, this.drawing.dots, fly ? this.camera.transform : null, this.viewport);
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
	}

	/** Reopens the default view without a flight, as a Back to an entry with no item does. */
	reopen(): void {
		if (!this.layout) return;
		this.pristine = true;
		this.camera.set(this.openView(this.layout));
	}

	paint(): void {
		this.painting = false;
		if (this.disposed) return;
		const transform = this.camera.transform;
		const layout = this.layout;
		const { dots, regions, links } = this.drawing;
		const outlines = this.outlinesFor(transform.k);
		const level = this.levels.frame(transform.k);
		const minimap = layout ? this.minimapFor(layout, transform) : null;
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
		const placed = layout
			? this.placeFor(level, {
				level: level.level,
				regions,
				outlines: new Map(outlines.map((outline) => [outline.key, outline])),
				dots,
				transform,
				viewport: this.viewport,
				measure: (text, font) => this.renderer.measureLabel(text, font),
				named: this.named,
				occupied: { circles: expand.map((control) => control.at), boxes: reserved },
			})
			: { labels: { regions: [], dots: [], cards: [] }, cards: [] };
		const { labels } = placed;
		const cards = this.cardsFor(level, placed.cards, transform);
		this.controls = [...labelControls(labels.regions), ...expand];
		this.renderer.draw({
			dots,
			regions: outlines,
			links,
			lighting: this.lighting,
			labels: labels.regions,
			dotLabels: labels.dots,
			controls: this.controls,
			cards: cards.set ? { keys: cards.set.keys, alpha: cards.alpha } : null,
			transform,
			level: level.level,
			ruler,
		});
		this.overlay.publish({ transform, rows: this.rows, cards: cards.set, cardAlpha: cards.alpha, minimap: minimap?.frame ?? null });
		// Empty means no glyph at the size it is drawn, and no card body, reaches the plot.
		const plot = { x: 0, y: 0, w: this.viewport.width, h: this.viewport.height };
		const glyphInView = dotsVisible(dots, transform, this.viewport, (dot) => screenRadius(dot, transform.k, level.level));
		const cardInView = cards.set?.dots.some((dot) => intersects(cardBox(dot, transform), plot)) ?? false;
		this.setViewportEmpty(dots.length > 0 && !glyphInView && !cardInView);
		// A fade has to be walked frame by frame; at rest nothing asks for another.
		if (level.from !== null) this.requestPaint();
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
	private minimapFor(layout: MapLayout, transform: Transform): { panel: Box; frame: MinimapFrame } | null {
		this.minimapOn = this.drawing.dots.length > 0 && minimapShows(transform.k, this.minScale(layout), this.minimapOn);
		if (!this.minimapOn) return null;
		const { bounds } = layout.frame;
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
		this.drawing = buildDrawList(layout, rows);
		this.outlines = new RegionOutlines(layout);
		this.deferred++;
		this.configureCamera(layout);
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
		const drawnBy = layout.representative[key];
		if (!drawnBy) return undefined;
		return layout.nodes.find((node) => node.kind === 'item' && node.key === drawnBy);
	}

	/** What a keyboard zoom holds still: the pointer if it is over the plot, otherwise the middle (undefined). A focused dot is SPE-236's to add. */
	private zoomAnchor(): ScreenPoint | undefined {
		const { pointer, viewport } = this;
		if (pointer && pointer.x >= 0 && pointer.x <= viewport.width && pointer.y >= 0 && pointer.y <= viewport.height) return pointer;
		return undefined;
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

	private openView(layout: MapLayout): ReturnType<typeof openTransform> {
		return openTransform(layout.frame.bounds, this.drawing.dots, this.viewport);
	}

	private minScale(layout: MapLayout): number {
		return fitScale(layout.frame.bounds, this.viewport);
	}

	private configureCamera(layout: MapLayout): void {
		this.camera.configure(this.viewport, layout.frame.bounds, this.minScale(layout));
	}
}
