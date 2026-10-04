import type { MapItemRow } from '@specboard/core/map-read';
import {
	ZOOM_STEP,
	centerOf,
	centeredOn,
	dotsVisible,
	fitScale,
	fitTransform,
	focusTransform,
	nearestDot,
	nowTransform,
	openTransform,
	type Viewport,
} from './camera';
import { controlAt, expandControls, labelControls, type CollapseControl } from './collapse-controls';
import { buildDrawList, type DrawList } from './draw-list';
import type { MapLayout, MapPoint } from './layout/types';
import { NO_LIGHTING, type LinkLighting } from './links';
import type { MapCamera, ScreenPoint } from './map-camera';
import { REST_LABELS, placeRegionLabels } from './region-labels';
import type { RegionOutline } from './regions/outline';
import { RegionOutlines, gridStep } from './regions/region-outlines';
import { RULER_HEIGHT, type MapRenderer } from './renderer';
import { rulerMarks } from './ruler';

/** Region labels are capped at rest while the camera is within this factor of fit all (spec, What shows when). */
const REST_ZOOM = 1.25;

export interface MapSurfaceHandlers {
	/** The plot has no dot in it, or has one again. */
	onViewportEmpty(empty: boolean): void;
	/** The person stopped panning or zooming; `key` is the item nearest the middle of the plot, if the Map has any. */
	onSettle(key: string | null): void;
}

export interface MapSurfaceDeps {
	renderer: MapRenderer;
	camera: MapCamera;
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
	private readonly unsubscribe: () => void;
	private layout: MapLayout | null = null;
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

	constructor(deps: MapSurfaceDeps, handlers: MapSurfaceHandlers) {
		this.renderer = deps.renderer;
		this.camera = deps.camera;
		this.schedule = deps.schedule;
		this.defer = deps.defer;
		this.timeZone = deps.timeZone;
		this.handlers = handlers;
		this.unsubscribe = this.camera.onChange(() => this.requestPaint());
	}

	destroy(): void {
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
		this.camera.set(target ? focusTransform(target, layout.frame.bounds, this.drawing.dots, null, this.viewport) : this.openView(layout));
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
		this.drawing = { dots: [], regions: [], links: [] };
		this.outlines = null;
		this.deferred++;
		this.controls = [];
		this.setViewportEmpty(false);
		this.requestPaint();
	}

	/** Which blocker and discovered-from links draw besides chains: all of them, or the ones focus lights. */
	setLighting(lighting: LinkLighting): void {
		this.lighting = lighting;
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
		const transform = this.camera.transform;
		const layout = this.layout;
		const { dots, regions, links } = this.drawing;
		const outlines = this.outlinesFor(transform.k);
		const expand = expandControls(dots, transform, this.viewport);
		const labels = layout
			? placeRegionLabels({
				regions,
				outlines: new Map(outlines.map((outline) => [outline.key, outline])),
				dots,
				transform,
				viewport: this.viewport,
				measure: (text) => this.renderer.measureLabel(text),
				cap: transform.k <= this.minScale(layout) * REST_ZOOM ? REST_LABELS : null,
				occupied: expand.map((control) => control.at),
			})
			: [];
		this.controls = [...labelControls(labels), ...expand];
		this.renderer.draw({
			dots,
			regions: outlines,
			links,
			lighting: this.lighting,
			labels,
			controls: this.controls,
			transform,
			ruler: layout
				? rulerMarks({
					ticks: layout.ticks,
					edge: layout.frame.scale.edge,
					quiet: layout.quiet,
					transform,
					width: this.viewport.width,
					timeZone: this.timeZone,
				})
				: null,
		});
		this.setViewportEmpty(dots.length > 0 && !dotsVisible(dots, transform, this.viewport));
	}

	private take(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>): void {
		this.layout = layout;
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
