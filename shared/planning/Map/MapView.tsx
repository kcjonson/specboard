import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { useModel } from '@specboard/models';
import { LoadError } from '../LoadError/LoadError';
import { createLayoutWorker } from './layout/layout-worker-client';
import { createCamera } from './map-camera';
import { MapDataModel } from './map-data-model';
import { createMapSource } from './map-source';
import { MapSurface } from './map-surface';
import { zoomKeyOf } from './map-keys';
import { readFocus, urlWithFocus } from './map-url';
import { RULER_HEIGHT, createCanvasRenderer } from './renderer';
import styles from './MapView.module.css';

export interface MapViewProps {
	projectRef: string;
	/** Tests hand in a model with a fake source and worker; the page builds its own. */
	model?: MapDataModel;
}

/** The layout fits itself to this plot shape until the container has been measured. */
const FALLBACK_ASPECT = 2;

const media = (query: string): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

/**
 * The Map: one canvas drawing every item's status glyph where the layout put it, a
 * ruler of dates along its bottom, and a camera on d3-zoom. The page loads this module
 * lazily, so Board and Table don't carry it.
 */
export function MapView({ projectRef, model: provided }: MapViewProps): JSX.Element {
	const model = useMemo(() => provided ?? new MapDataModel(createMapSource(projectRef), createLayoutWorker), [provided, projectRef]);
	useModel(model);

	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const surfaceRef = useRef<MapSurface | null>(null);
	const [viewportEmpty, setViewportEmpty] = useState(false);

	// Panning and zooming replace the history entry, so a copied URL anchors on the item in
	// the middle of the plot (spec, Navigation and interaction); a jump pushes one.
	const anchor = useCallback((key: string | null, push: boolean): void => {
		const url = urlWithFocus(window.location, key);
		if (push) navigate(url);
		else if (url !== window.location.pathname + window.location.search + window.location.hash) {
			window.history.replaceState(window.history.state, '', url);
		}
	}, []);

	useEffect(() => {
		const container = containerRef.current!;
		const canvas = canvasRef.current!;
		const reducedMotion = media('(prefers-reduced-motion: reduce)');
		const colorScheme = media('(prefers-color-scheme: dark)');

		const camera = createCamera(canvas, {
			reducedMotion: () => reducedMotion?.matches ?? false,
			onSettle: () => surfaceRef.current?.settled(),
		});
		const surface = new MapSurface(
			{ renderer: createCanvasRenderer(canvas), camera, schedule: (paint) => window.requestAnimationFrame(paint) },
			{
				onViewportEmpty: setViewportEmpty,
				onSettle: (key) => {
					if (key) anchor(key, false);
				},
			},
		);
		surfaceRef.current = surface;

		const measure = (): { width: number; height: number } => {
			const { width, height } = container.getBoundingClientRect();
			surface.resize(width, height);
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
		const onPointerMove = (event: MouseEvent): void => {
			const { left, top } = canvas.getBoundingClientRect();
			surface.setPointer({ x: event.clientX - left, y: event.clientY - top });
		};
		const onPointerLeave = (): void => surface.setPointer(null);
		canvas.addEventListener('mousemove', onPointerMove);
		canvas.addEventListener('mouseleave', onPointerLeave);
		const onKeyDown = (event: KeyboardEvent): void => {
			const zoom = zoomKeyOf(event);
			if (!zoom) return;
			event.preventDefault();
			if (zoom === 'in') surface.zoomInByKey();
			else surface.zoomOutByKey();
		};
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			canvas.removeEventListener('mousemove', onPointerMove);
			canvas.removeEventListener('mouseleave', onPointerLeave);
			window.removeEventListener('popstate', onPopState);
			colorScheme?.removeEventListener('change', onColorScheme);
			observer?.disconnect();
			surface.destroy();
			camera.destroy();
			surfaceRef.current = null;
			model.dispose();
		};
	}, [model, anchor]);

	const { state, layout, rows } = model;
	useEffect(() => {
		const surface = surfaceRef.current!;
		if (state === 'ready' && layout) surface.show(layout, rows, readFocus(window.location.search));
		else surface.clear();
	}, [state, layout, rows]);

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
	const handleRetry = useCallback((): void => void model.retry(), [model]);

	const interactive = state === 'ready' && !model.isEmpty;

	return (
		<div class={styles.map} ref={containerRef}>
			<canvas
				ref={canvasRef}
				class={styles.canvas}
				role="img"
				aria-label={interactive ? `Map of ${rows.size} items` : 'Map'}
			/>
			<div class={styles.controls} role="group" aria-label="Map view">
				<button type="button" class={styles.control} disabled={!interactive} onClick={handleFitAll}>Fit all</button>
				<button type="button" class={styles.control} disabled={!interactive} onClick={handleNow}>Now</button>
				<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom out" onClick={() => surface().zoomOut()}>&minus;</button>
				<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom in" onClick={() => surface().zoomIn()}>+</button>
			</div>
			<div class={styles.overlay} style={{ bottom: `${RULER_HEIGHT}px` }}>
				{state === 'loading' && <p class={styles.message} role="status">Loading the map...</p>}
				{state === 'error' && model.error && <LoadError error={model.error} onRetry={handleRetry} />}
				{model.isEmpty && <p class={styles.message}>Nothing on the map yet. New items land at the right edge.</p>}
				{interactive && viewportEmpty && (
					<button type="button" class={styles.jump} onClick={handleJumpToNearest}>Jump to the nearest dots</button>
				)}
			</div>
		</div>
	);
}
