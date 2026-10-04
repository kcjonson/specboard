import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { useModel } from '@specboard/models';
import { LoadError } from '../LoadError/LoadError';
import { MapCards } from './cards/MapCards';
import { createCollapseStore } from './collapse-store';
import { DRAG_THRESHOLD } from './drag';
import type { Hit } from './hit-index';
import { createLayoutWorker } from './layout/layout-worker-client';
import type { MapPoint } from './layout/types';
import { createCamera, type ScreenPoint } from './map-camera';
import { MapDataModel } from './map-data-model';
import { createMapSource } from './map-source';
import { MapSurface } from './map-surface';
import { Minimap } from './minimap/Minimap';
import { OverlayStore } from './overlay';
import { ActivityCache, createActivitySource } from './quick/activity-cache';
import { MapQuickCard } from './quick/MapQuickCard';
import { zoomKeyOf } from './map-keys';
import { readFocus, urlWithFocus } from './map-url';
import { RULER_HEIGHT, createCanvasRenderer } from './renderer';
import styles from './MapView.module.css';

export interface MapViewProps {
	projectRef: string;
	/** The item the drawer shows (the item URL's key), which the Map keeps selected and in view. */
	openItemKey?: string;
	/** How much of the Map's right side the drawer overlays, in px; 0 while it is closed. */
	covered: number;
	/** A click, Enter on the focused item, or a second tap asks for an item to open in the drawer. */
	onOpenItem(key: string): void;
	/** Escape asks the drawer to close. */
	onCloseItem(): void;
	/** Tests hand in a model with a fake source and worker; the page builds its own. */
	model?: MapDataModel;
	/** Tests hand in the quick card's activity source; the page asks the notes endpoint. */
	activity?: ActivityCache;
}

/** The layout fits itself to this plot shape until the container has been measured. */
const FALLBACK_ASPECT = 2;

/** Outlines for a new zoom wait this long after the last frame that wanted them, so a gesture never stalls on them. */
const DEFER_MS = 150;

/** Cards and labels keep this far from the toolbar and the notice that sit over the plot. */
const CHROME_PAD = 8;

/** A finger moves a little more than a mouse does while it is only pressing. */
const TOUCH_THRESHOLD = 10;

const media = (query: string): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

/** A press on the plot, from pointer down to up. */
interface Press {
	id: number;
	start: ScreenPoint;
	hit: Hit | null;
	touch: boolean;
	/** It has moved past the click threshold: whatever it is, it is no longer a click. */
	moved: boolean;
	/** It is pulling a dot. */
	dragging: boolean;
}

const typing = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * The Map: one canvas drawing every item's status glyph where the layout put it, a
 * region around every family with its label and collapse control, the links that
 * show, labels that fade with the zoom level, a ruler of dates along its bottom, and
 * a camera on d3-zoom; over it, DOM cards at the near level, the quick card, and a
 * minimap once zoomed in. Hover, focus, and selection light an item's relations; a
 * click opens the drawer the board uses. The page loads this module lazily, so Board
 * and Table don't carry it.
 */
export function MapView({ projectRef, openItemKey, covered, onOpenItem, onCloseItem, model: provided, activity: providedActivity }: MapViewProps): JSX.Element {
	const model = useMemo(
		() => provided ?? new MapDataModel(createMapSource(projectRef), createLayoutWorker, createCollapseStore(projectRef)),
		[provided, projectRef],
	);
	useModel(model);
	const activity = useMemo(() => providedActivity ?? new ActivityCache(createActivitySource(projectRef)), [providedActivity, projectRef]);

	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const noticeRef = useRef<HTMLParagraphElement>(null);
	const surfaceRef = useRef<MapSurface | null>(null);
	const [viewportEmpty, setViewportEmpty] = useState(false);
	const [allLinks, setAllLinks] = useState(false);
	const overlay = useMemo(() => new OverlayStore(), []);

	// The surface lives as long as the view, so what it calls back into is read from here.
	const live = useRef({ openItemKey, onOpenItem, onCloseItem, model });
	live.current = { openItemKey, onOpenItem, onCloseItem, model };

	// Panning and zooming replace the history entry, so a copied URL anchors on the item in
	// the middle of the plot (spec, Navigation and interaction); a jump pushes one.
	const anchor = useCallback((key: string | null, push: boolean): void => {
		const url = urlWithFocus(window.location, key);
		if (push) navigate(url);
		else if (url !== window.location.pathname + window.location.search + window.location.hash) {
			window.history.replaceState(window.history.state, '', url);
		}
	}, []);

	// The toolbar and the notice sit over the plot, so cards and labels are placed around them.
	const reserveChrome = useCallback((): void => {
		const surface = surfaceRef.current;
		const container = containerRef.current;
		if (!surface || !container) return;
		const origin = container.getBoundingClientRect();
		const boxes = [controlsRef.current, noticeRef.current].flatMap((element) => {
			if (!element) return [];
			const rect = element.getBoundingClientRect();
			return [{ x: rect.left - origin.left - CHROME_PAD, y: rect.top - origin.top - CHROME_PAD, w: rect.width + 2 * CHROME_PAD, h: rect.height + 2 * CHROME_PAD }];
		});
		surface.setChrome(boxes);
	}, []);

	useEffect(() => {
		const container = containerRef.current!;
		const canvas = canvasRef.current!;
		const reducedMotion = media('(prefers-reduced-motion: reduce)');
		const colorScheme = media('(prefers-color-scheme: dark)');

		// A press on a dot's glyph is the start of a drag, which the camera must not pan from.
		let claimed = false;
		const camera = createCamera(canvas, {
			reducedMotion: () => reducedMotion?.matches ?? false,
			onSettle: () => surfaceRef.current?.settled(),
			claims: () => claimed,
		});
		const surface = new MapSurface(
			{
				renderer: createCanvasRenderer(canvas),
				camera,
				overlay,
				now: () => window.performance.now(),
				reducedMotion: () => reducedMotion?.matches ?? false,
				schedule: (paint) => window.requestAnimationFrame(paint),
				defer: (task) => window.setTimeout(task, DEFER_MS),
			},
			{
				onViewportEmpty: setViewportEmpty,
				onSettle: (key) => {
					if (key) anchor(key, false);
				},
				onOpen: (key) => live.current.onOpenItem(key),
				onCollapse: (key, collapse) => void live.current.model.setCollapsed(key, collapse),
				onPointerTarget: (target) => {
					if (target) canvas.dataset.target = target;
					else delete canvas.dataset.target;
				},
			},
		);
		surfaceRef.current = surface;

		const measure = (): { width: number; height: number } => {
			const { width, height } = container.getBoundingClientRect();
			surface.resize(width, height);
			reserveChrome();
			return { width, height: height - RULER_HEIGHT };
		};
		const { width, height } = measure();
		void model.load(width > 0 && height > 0 ? width / height : FALLBACK_ASPECT);

		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
		observer?.observe(container);
		const onColorScheme = (): void => surface.refreshTheme();
		colorScheme?.addEventListener('change', onColorScheme);
		// Back and Forward move between anchors; an entry with none is the opening view.
		const onPopState = (): void => {
			const key = readFocus(window.location.search);
			if (!key || !surface.focusOn(key, false)) surface.reopen();
		};
		window.addEventListener('popstate', onPopState);

		const pointOf = (event: MouseEvent): ScreenPoint => {
			const { left, top } = canvas.getBoundingClientRect();
			return { x: event.clientX - left, y: event.clientY - top };
		};
		let press: Press | null = null;
		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			// A second finger down is a pinch, which is no click.
			if (press) {
				press.moved = true;
				return;
			}
			const point = pointOf(event);
			const touch = event.pointerType === 'touch';
			const hit = surface.hitAt(point, touch);
			press = { id: event.pointerId, start: point, hit, touch, moved: false, dragging: false };
			claimed = !touch && hit?.type === 'dot' && hit.part === 'glyph';
			// Captured, so a release outside the canvas still ends the press instead of leaving it open.
			canvas.setPointerCapture?.(event.pointerId);
		};
		const onPointerMove = (event: PointerEvent): void => {
			const point = pointOf(event);
			if (press) {
				if (press.id !== event.pointerId) return;
				const threshold = press.touch ? TOUCH_THRESHOLD : DRAG_THRESHOLD;
				if (!press.moved && Math.hypot(point.x - press.start.x, point.y - press.start.y) > threshold) {
					press.moved = true;
					if (claimed && press.hit?.type === 'dot') {
						press.dragging = true;
						canvas.dataset.dragging = '';
						surface.beginDrag(press.hit.key, press.start);
					}
				}
				if (press.dragging) surface.dragTo(point);
				return;
			}
			// A finger has no hover, and a button held is a pan: neither is worth a hit test.
			if (event.pointerType === 'touch' || event.buttons !== 0) return;
			surface.hoverAt(point);
		};
		const onPointerEnd = (event: PointerEvent): void => {
			if (!press || press.id !== event.pointerId) return;
			const ended = press;
			press = null;
			claimed = false;
			delete canvas.dataset.dragging;
			if (ended.dragging) surface.endDrag();
			else if (event.type === 'pointerup' && !ended.moved) surface.tap(ended.hit, ended.touch);
		};
		const onPointerLeave = (event: PointerEvent): void => {
			if (event.pointerType !== 'touch' && !press?.dragging) surface.hoverAt(null);
		};
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerEnd);
		canvas.addEventListener('pointercancel', onPointerEnd);
		canvas.addEventListener('pointerleave', onPointerLeave);

		const onKeyDown = (event: KeyboardEvent): void => {
			const zoom = zoomKeyOf(event);
			if (zoom) {
				event.preventDefault();
				if (zoom === 'in') surface.zoomInByKey();
				else surface.zoomOutByKey();
				return;
			}
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
			if (event.key === 'Escape') {
				// A dialog over the page has its own Escape.
				if ((event.target as HTMLElement | null)?.closest?.('dialog, [role="dialog"]')) return;
				// The drawer first, then the selection it leaves lit.
				if (live.current.openItemKey) {
					event.preventDefault();
					live.current.onCloseItem();
				} else if (surface.selection !== null) {
					event.preventDefault();
					surface.select(null);
				}
			} else if (event.key === 'Enter' && (event.target === document.body || event.target === canvas)) {
				if (surface.activateFocus() !== null) event.preventDefault();
			}
		};
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerup', onPointerEnd);
			canvas.removeEventListener('pointercancel', onPointerEnd);
			canvas.removeEventListener('pointerleave', onPointerLeave);
			window.removeEventListener('popstate', onPopState);
			colorScheme?.removeEventListener('change', onColorScheme);
			observer?.disconnect();
			surface.destroy();
			camera.destroy();
			surfaceRef.current = null;
			model.dispose();
		};
	}, [model, anchor, overlay, reserveChrome]);

	const { state, layout, rows } = model;
	const summarizedNotice = state === 'ready' && !model.isEmpty && model.read?.summarized === true;
	useEffect(reserveChrome, [summarizedNotice, reserveChrome]);
	useEffect(() => {
		const surface = surfaceRef.current!;
		if (state !== 'ready' || !layout) surface.clear();
		else if (surface.showing) surface.update(layout, rows);
		else surface.show(layout, rows, readFocus(window.location.search));
	}, [state, layout, rows]);

	// The item URL is the selection: a link to an item opens it on the Map, and the drawer's
	// related items move it. The drawer overlays the plot, so the camera pans just far enough
	// to keep the selection clear of it.
	useEffect(() => {
		const surface = surfaceRef.current!;
		surface.setDrawer(openItemKey ?? null);
		if (openItemKey) surface.select(openItemKey);
	}, [openItemKey]);
	useEffect(() => surfaceRef.current!.setCovered(covered), [covered]);
	const interactive = state === 'ready' && !model.isEmpty;
	const drawerShowing = covered > 0;
	useEffect(() => {
		if (openItemKey && drawerShowing && interactive) surfaceRef.current!.reveal(openItemKey);
	}, [openItemKey, drawerShowing, interactive]);
	useEffect(() => surfaceRef.current!.setAllLinks(allLinks), [allLinks]);

	const surface = (): MapSurface => surfaceRef.current!;
	const handleFitAll = useCallback((): void => {
		surface().fitAll();
		anchor(null, true);
	}, [anchor]);
	const handleNow = useCallback((): void => {
		surface().now();
		anchor(null, true);
	}, [anchor]);
	const handleJumpToNearest = useCallback((): void => {
		const key = surface().jumpToNearest();
		if (key) anchor(key, true);
	}, [anchor]);
	const handleCenter = useCallback((point: MapPoint, fly: boolean): void => surface().centerOn(point, fly), []);
	const handleRetry = useCallback((): void => void model.retry(), [model]);
	const handleAllLinks = useCallback((): void => setAllLinks((on) => !on), []);

	// Past the read cap, finished families come back folded into one row, so the count is of rows, not of items.
	const summarized = interactive && model.read?.summarized === true;

	return (
		<div class={styles.map} ref={containerRef}>
			<canvas
				ref={canvasRef}
				class={styles.canvas}
				role="img"
				aria-label={interactive ? `Map of ${rows.size} items${summarized ? ', with finished families summarized' : ''}` : 'Map'}
			/>
			<MapCards store={overlay} bottom={RULER_HEIGHT} />
			<MapQuickCard store={overlay} activity={activity} bottom={RULER_HEIGHT} />
			<div class={styles.controls} ref={controlsRef} role="group" aria-label="Map view">
				<button type="button" class={styles.control} disabled={!interactive} onClick={handleFitAll}>Fit all</button>
				<button type="button" class={styles.control} disabled={!interactive} onClick={handleNow}>Now</button>
				<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom out" onClick={() => surface().zoomOut()}>&minus;</button>
				<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom in" onClick={() => surface().zoomIn()}>+</button>
				<button type="button" class={styles.control} disabled={!interactive} aria-pressed={allLinks} onClick={handleAllLinks}>All links</button>
			</div>
			{summarized && <p class={styles.notice} ref={noticeRef} role="status">This project is past the read cap, so finished families are summarized.</p>}
			<div class={styles.overlay} style={{ bottom: `${RULER_HEIGHT}px` }}>
				{state === 'loading' && <p class={styles.message} role="status">Loading the map...</p>}
				{state === 'error' && model.error && <LoadError error={model.error} onRetry={handleRetry} />}
				{model.isEmpty && <p class={styles.message}>Nothing on the map yet. New items land at the right edge.</p>}
				{interactive && viewportEmpty && (
					<button type="button" class={styles.jump} onClick={handleJumpToNearest}>Jump to the nearest dots</button>
				)}
			</div>
			<Minimap store={overlay} onCenter={handleCenter} />
		</div>
	);
}
