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
import { buildDrawList, type DrawDot } from './draw-list';
import type { MapLayout } from './layout/types';
import type { MapCamera } from './map-camera';
import { RULER_HEIGHT, type MapRenderer } from './renderer';
import { rulerMarks } from './ruler';

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
	timeZone?: string;
}

/**
 * Everything between the data and the pixels: the draw list, the camera's targets, the
 * ruler, and when to repaint. The renderer and camera come in through their interfaces,
 * so this is the part a test drives, and later layers (regions, labels, selection) add
 * to what `paint` draws without touching the camera.
 */
export class MapSurface {
	private readonly renderer: MapRenderer;
	private readonly camera: MapCamera;
	private readonly schedule: (paint: () => void) => void;
	private readonly handlers: MapSurfaceHandlers;
	private readonly timeZone: string | undefined;
	private readonly unsubscribe: () => void;
	private layout: MapLayout | null = null;
	private dots: DrawDot[] = [];
	private viewport: Viewport = { width: 0, height: 0 };
	private painting = false;
	private viewportEmpty = false;
	/** Nobody has panned or zoomed yet, so a resize reopens the default view instead of holding the old center. */
	private pristine = true;

	constructor(deps: MapSurfaceDeps, handlers: MapSurfaceHandlers) {
		this.renderer = deps.renderer;
		this.camera = deps.camera;
		this.schedule = deps.schedule;
		this.timeZone = deps.timeZone;
		this.handlers = handlers;
		this.unsubscribe = this.camera.onChange(() => this.requestPaint());
	}

	destroy(): void {
		this.unsubscribe();
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

	/** Draws a settled layout, opening on `focusKey` if the Map has it and on now otherwise. */
	show(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, focusKey: string | null): void {
		this.layout = layout;
		this.dots = buildDrawList(layout, rows);
		this.pristine = true;
		this.configureCamera(layout);
		const target = focusKey ? this.dots.find((dot) => dot.key === focusKey) : undefined;
		this.camera.set(target ? focusTransform(target, layout.frame.bounds, this.dots, null, this.viewport) : this.openView(layout));
		this.requestPaint();
	}

	/** Back to the ruler's frame alone: loading, an empty project, or an error. */
	clear(): void {
		this.layout = null;
		this.dots = [];
		this.setViewportEmpty(false);
		this.requestPaint();
	}

	fitAll(): void {
		if (!this.layout) return;
		this.camera.flyTo(fitTransform(this.layout.frame.bounds, this.viewport));
	}

	now(): void {
		if (!this.layout) return;
		this.camera.flyTo(nowTransform(this.layout.frame.bounds, this.dots, this.viewport));
	}

	zoomIn(): void {
		this.camera.zoomBy(ZOOM_STEP);
	}

	zoomOut(): void {
		this.camera.zoomBy(1 / ZOOM_STEP);
	}

	/** Moves to an item, with a flight unless told otherwise. False when the Map has no such dot, which includes anything folded into another. */
	focusOn(key: string, fly = true): boolean {
		const target = this.dots.find((dot) => dot.key === key);
		if (!this.layout || !target) return false;
		const view = focusTransform(target, this.layout.frame.bounds, this.dots, fly ? this.camera.transform : null, this.viewport);
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
		return nearestDot(this.dots, centerOf(this.camera.transform, this.viewport))?.key ?? null;
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
		this.renderer.draw({
			dots: this.dots,
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
		this.setViewportEmpty(this.dots.length > 0 && !dotsVisible(this.dots, transform, this.viewport));
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
		return openTransform(layout.frame.bounds, this.dots, this.viewport);
	}

	private minScale(layout: MapLayout): number {
		return fitScale(layout.frame.bounds, this.viewport);
	}

	private configureCamera(layout: MapLayout): void {
		this.camera.configure(this.viewport, layout.frame.bounds, this.minScale(layout));
	}
}
