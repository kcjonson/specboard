import { select } from 'd3-selection';
import 'd3-transition';
import type { Transition } from 'd3-transition';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3-zoom';
import { MAX_SCALE, constrainTransform, cubicBezier, type Transform, type Viewport } from './camera';
import type { MapBounds } from './layout/types';

/** A camera flight, per the spec's motion table. */
const FLIGHT_MS = 450;
const FLIGHT_EASE = cubicBezier(0.2, 0, 0, 1);

/** After the last pan or zoom input, this long passes before the camera counts as settled. */
const SETTLE_MS = 250;

/** Pixels in one "line" of a wheel that scrolls by lines. */
const WHEEL_LINE = 16;

/** A position in the plot, CSS pixels from its top left. */
export interface ScreenPoint {
	x: number;
	y: number;
}

export interface MapCamera {
	/** Where the camera is now. A copy: it changes under every gesture. */
	readonly transform: Transform;
	/** Fires on every change of the transform, whoever caused it. Returns the unsubscribe. */
	onChange(listener: () => void): () => void;
	/** The plot's size and the Map's extent, which pan and zoom are held to. */
	configure(viewport: Viewport, bounds: MapBounds | null, minScale: number): void;
	/** Moves the camera with no flight. */
	set(transform: Transform): void;
	/** Moves the camera by this many screen pixels with no flight: the Map following a dot a refresh moved, so it stays put on screen. */
	panBy(dx: number, dy: number): void;
	/** A flight (Fit all, Now, a jump, a keyed zoom) is under way. */
	readonly flying: boolean;
	/** Moves the camera with a short flight, or without one under reduced motion. */
	flyTo(transform: Transform): void;
	/** Zooms about a point in the plot, or about its middle. */
	zoomBy(factor: number, around?: ScreenPoint): void;
	destroy(): void;
}

export interface CameraOptions {
	reducedMotion(): boolean;
	/** The person stopped panning or zooming (not a flight, and not a resize). */
	onSettle(): void;
	/** A press the Map takes for itself, such as the start of a dot's drag, which the camera then leaves alone instead of panning. */
	claims?(event: Event): boolean;
}

const toZoom = (t: Transform): ZoomTransform => zoomIdentity.translate(t.x, t.y).scale(t.k);

/**
 * d3-zoom's camera on the canvas. Its defaults zoom on every wheel event, which is a
 * mouse's idea of a wheel; a trackpad's two-finger scroll is a pan. So d3 keeps drag,
 * touch, and the zooming wheel (ctrl for a pinch, cmd for a held key), and a plain
 * wheel pans through its own handler here.
 */
export function createCamera(element: HTMLElement, options: CameraOptions): MapCamera {
	const selection = select(element);
	let viewport: Viewport = { width: element.clientWidth, height: element.clientHeight };
	let bounds: MapBounds | null = null;
	let current: Transform = { k: 1, x: 0, y: 0 };
	let byPerson = false;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	const listeners = new Set<() => void>();

	const settleSoon = (): void => {
		clearTimeout(settleTimer);
		settleTimer = setTimeout(options.onSettle, SETTLE_MS);
	};

	const behavior = zoom<HTMLElement, unknown>()
		.scaleExtent([0.01, MAX_SCALE])
		.extent(() => [[0, 0], [viewport.width, viewport.height]])
		.filter((event: Event) => {
			if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
			if (options.claims?.(event)) return false;
			return !(event as MouseEvent).ctrlKey && !(event as MouseEvent).button;
		})
		.constrain((transform) => (bounds ? toZoom(constrainTransform(transform, bounds, viewport)) : transform))
		.on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
			current = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
			if (event.sourceEvent || byPerson) settleSoon();
			for (const listener of [...listeners]) listener();
		});
	selection.call(behavior).on('dblclick.zoom', null);

	const pan = (event: WheelEvent): void => {
		if (event.ctrlKey || event.metaKey) return;
		event.preventDefault();
		const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? viewport.height : 1;
		selection.interrupt();
		byPerson = true;
		behavior.translateBy(selection, (-event.deltaX * unit) / current.k, (-event.deltaY * unit) / current.k);
		byPerson = false;
	};
	element.addEventListener('wheel', pan, { passive: false });
	let flights = 0;
	const glide = (): Transition<HTMLElement, unknown, null, undefined> => {
		flights++;
		// A flight cut off before its first frame is cancelled rather than interrupted.
		return selection.transition().duration(FLIGHT_MS).ease(FLIGHT_EASE).on('end.flight interrupt.flight cancel.flight', () => {
			flights = Math.max(0, flights - 1);
		});
	};

	return {
		get transform() {
			return { ...current };
		},
		get flying() {
			return flights > 0;
		},
		panBy(dx, dy) {
			behavior.translateBy(selection, dx / current.k, dy / current.k);
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		configure(nextViewport, nextBounds, minScale) {
			viewport = nextViewport;
			bounds = nextBounds;
			behavior.scaleExtent([Math.min(minScale, MAX_SCALE), MAX_SCALE]);
		},
		set(transform) {
			selection.interrupt();
			behavior.transform(selection, toZoom(transform));
		},
		flyTo(transform) {
			if (options.reducedMotion()) {
				this.set(transform);
				return;
			}
			selection.interrupt();
			behavior.transform(glide(), toZoom(transform));
		},
		zoomBy(factor, around) {
			selection.interrupt();
			byPerson = true;
			const point: [number, number] | undefined = around && [around.x, around.y];
			if (options.reducedMotion()) {
				behavior.scaleBy(selection, factor, point);
				byPerson = false;
				return;
			}
			// A zoom the person asked for settles like a pinch does, once its flight lands.
			behavior.scaleBy(glide().on('end.map interrupt.map', () => (byPerson = false)), factor, point);
		},
		destroy() {
			clearTimeout(settleTimer);
			selection.interrupt();
			selection.on('.zoom', null);
			element.removeEventListener('wheel', pan);
			listeners.clear();
		},
	};
}
