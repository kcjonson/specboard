import { MAX_SCALE, constrainTransform, cubicBezier, type Transform, type Viewport } from './camera';
import type { MapBounds, MapPoint } from './layout/types';

/** A camera flight, per the spec's motion table. */
const FLIGHT_MS = 450;
const FLIGHT_EASE = cubicBezier(0.2, 0, 0, 1);

/** After the last pan or zoom input, this long passes before the camera counts as settled. */
const SETTLE_MS = 250;

/** Pixels in one "line" of a wheel that scrolls by lines. */
const WHEEL_LINE = 16;

/**
 * How far a zooming wheel zooms, in powers of two per pixel, line, and page of delta.
 * A trackpad pinch arrives as a ctrl-wheel with small deltas, so ctrl counts ten times over.
 */
const ZOOM_PER_PIXEL = 0.002;
const ZOOM_PER_LINE = 0.05;
const ZOOM_PER_PAGE = 1;
const PINCH_GAIN = 10;

/** The zoom-out limit before the Map has a fit scale to hold it to. */
const MIN_SCALE = 0.01;

/** Van Wijk and Nuij's curvature for a smooth zoom and pan: how far a long flight backs out on its way. */
const RHO = Math.SQRT2;

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
	/** Zooms by `factor` and brings what is under `at` to the middle of the plot: the zoom tool's click. */
	zoomInto(factor: number, at: ScreenPoint): void;
	destroy(): void;
}

export interface CameraOptions {
	reducedMotion(): boolean;
	/** The person stopped panning or zooming (not a flight, and not a resize). */
	onSettle(): void;
	/**
	 * A press the Map takes for itself, such as the start of a dot's drag, which the camera then
	 * leaves alone instead of panning. Asked when the press first moves, so every pointerdown
	 * listener has seen it by then.
	 */
	claims?(event: PointerEvent): boolean;
}

/** A pointer held on the plot, and the layout point it holds. */
interface Contact {
	at: ScreenPoint;
	holds: MapPoint;
}

const invert = (t: Transform, p: ScreenPoint): MapPoint => ({ x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k });

/** The transform at scale `k` that puts layout point `holds` under screen point `at`. */
const hold = (k: number, holds: MapPoint, at: ScreenPoint): Transform => ({ k, x: at.x - k * holds.x, y: at.y - k * holds.y });

const middle = (a: MapPoint, b: MapPoint): MapPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The path of a flight from `from` to `to`, seen from screen point `p`: van Wijk and Nuij's
 * smooth zoom and pan (d3's interpolateZoom), which backs out on a long move so it stays
 * legible, and is a plain exponential zoom when `p` holds still. `size` is the plot's
 * larger side.
 */
export function flightPath(from: Transform, to: Transform, p: ScreenPoint, size: number): (t: number) => Transform {
	const a = invert(from, p);
	const b = invert(to, p);
	const w0 = size / from.k;
	const w1 = size / to.k;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const d2 = dx * dx + dy * dy;
	const at = (u: number, w: number): Transform => hold(size / w, { x: a.x + u * dx, y: a.y + u * dy }, p);
	if (d2 < 1e-12) {
		const s = Math.log(w1 / w0);
		return (t) => at(t, w0 * Math.exp(t * s));
	}
	const d = Math.sqrt(d2);
	const rho2 = RHO * RHO;
	const r0 = -Math.asinh((w1 * w1 - w0 * w0 + rho2 * rho2 * d2) / (2 * w0 * rho2 * d));
	const r1 = -Math.asinh((w1 * w1 - w0 * w0 - rho2 * rho2 * d2) / (2 * w1 * rho2 * d));
	return (t) => {
		const r = r0 + t * (r1 - r0);
		return at((w0 / (rho2 * d)) * (Math.cosh(r0) * Math.tanh(r) - Math.sinh(r0)), (w0 * Math.cosh(r0)) / Math.cosh(r));
	};
}

/**
 * The Map's camera on the canvas: drag to pan (mouse, pen, one finger), two fingers to pinch,
 * a plain wheel or a trackpad's two-finger scroll to pan, ctrl/cmd-wheel (a trackpad pinch
 * arrives as ctrl-wheel) to zoom about the pointer, and flights for everything else. A drag
 * holds the layout point under the pointer there, and a pinch holds the two under its fingers,
 * so the Map moves with the hand. Any input cuts a flight short.
 */
export function createCamera(element: HTMLElement, options: CameraOptions): MapCamera {
	let viewport: Viewport = { width: element.clientWidth, height: element.clientHeight };
	let bounds: MapBounds | null = null;
	let minScale = MIN_SCALE;
	let current: Transform = { k: 1, x: 0, y: 0 };
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let flight: number | null = null;
	const listeners = new Set<() => void>();
	const contacts = new Map<number, Contact>();
	let asked = false;

	const clampScale = (k: number): number => Math.max(minScale, Math.min(MAX_SCALE, k));
	const constrain = (t: Transform): Transform => (bounds ? constrainTransform(t, bounds, viewport) : t);
	const plotMiddle = (): ScreenPoint => ({ x: viewport.width / 2, y: viewport.height / 2 });
	const pointOf = (event: MouseEvent): ScreenPoint => {
		const { left, top } = element.getBoundingClientRect();
		return { x: event.clientX - left, y: event.clientY - top };
	};

	const apply = (next: Transform, byPerson: boolean): void => {
		current = { k: next.k, x: next.x, y: next.y };
		if (byPerson) {
			clearTimeout(settleTimer);
			settleTimer = setTimeout(options.onSettle, SETTLE_MS);
		}
		for (const listener of [...listeners]) listener();
	};

	const land = (): void => {
		if (flight === null) return;
		cancelAnimationFrame(flight);
		flight = null;
	};

	/** A person's zoom (a key or a button) settles like a pinch does, once it lands. */
	const fly = (to: Transform, around: ScreenPoint, byPerson: boolean): void => {
		land();
		const path = flightPath(current, to, around, Math.max(viewport.width, viewport.height));
		const start = window.performance.now();
		const step = (): void => {
			const t = Math.min(1, (window.performance.now() - start) / FLIGHT_MS);
			flight = t < 1 ? requestAnimationFrame(step) : null;
			apply(t < 1 ? path(FLIGHT_EASE(t)) : to, byPerson);
		};
		flight = requestAnimationFrame(step);
	};

	/** Where the held pointers put the camera: one pans, two pinch about their middle. */
	const held = (): Transform => {
		const [a, b] = [...contacts.values()] as [Contact, Contact | undefined];
		if (!b) return hold(current.k, a.holds, a.at);
		const apart = Math.hypot(b.holds.x - a.holds.x, b.holds.y - a.holds.y);
		const k = apart > 0 ? clampScale(Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y) / apart) : current.k;
		return hold(k, middle(a.holds, b.holds), middle(a.at, b.at));
	};

	/** The pointers held changed, so each one now holds whatever is under it. */
	const regrip = (): void => {
		for (const contact of contacts.values()) contact.holds = invert(current, contact.at);
	};

	const noSelect = (event: Event): void => event.preventDefault();

	const release = (): void => {
		contacts.clear();
		window.removeEventListener('selectstart', noSelect);
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || event.ctrlKey || contacts.size >= 2) return;
		land();
		if (contacts.size === 0) {
			asked = false;
			// A mouse drag that wanders over the cards would otherwise select their text.
			if (event.pointerType !== 'touch') window.addEventListener('selectstart', noSelect);
		}
		contacts.set(event.pointerId, { at: pointOf(event), holds: { x: 0, y: 0 } });
		regrip();
		element.setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent): void => {
		const contact = contacts.get(event.pointerId);
		if (!contact) return;
		if (!asked) {
			asked = true;
			if (options.claims?.(event)) {
				release();
				return;
			}
		}
		contact.at = pointOf(event);
		land();
		apply(constrain(held()), true);
	};

	const onPointerEnd = (event: PointerEvent): void => {
		if (!contacts.delete(event.pointerId)) return;
		if (contacts.size === 0) release();
		else regrip();
	};

	const onWheel = (event: WheelEvent): void => {
		event.preventDefault();
		land();
		const { deltaMode } = event;
		if (event.ctrlKey || event.metaKey) {
			const rate = deltaMode === 1 ? ZOOM_PER_LINE : deltaMode === 2 ? ZOOM_PER_PAGE : ZOOM_PER_PIXEL;
			const k = clampScale(current.k * 2 ** (-event.deltaY * rate * (event.ctrlKey ? PINCH_GAIN : 1)));
			if (k === current.k) return;
			const at = pointOf(event);
			apply(constrain(hold(k, invert(current, at), at)), true);
			return;
		}
		const unit = deltaMode === 1 ? WHEEL_LINE : deltaMode === 2 ? viewport.height : 1;
		apply(constrain({ k: current.k, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit }), true);
	};

	element.addEventListener('pointerdown', onPointerDown);
	element.addEventListener('pointermove', onPointerMove);
	element.addEventListener('pointerup', onPointerEnd);
	element.addEventListener('pointercancel', onPointerEnd);
	element.addEventListener('wheel', onWheel, { passive: false });

	return {
		get transform() {
			return { ...current };
		},
		get flying() {
			return flight !== null;
		},
		panBy(dx, dy) {
			land();
			apply(constrain({ k: current.k, x: current.x + dx, y: current.y + dy }), false);
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		configure(nextViewport, nextBounds, nextMinScale) {
			viewport = nextViewport;
			bounds = nextBounds;
			minScale = Math.min(nextMinScale, MAX_SCALE);
		},
		set(transform) {
			land();
			apply(transform, false);
		},
		flyTo(transform) {
			if (options.reducedMotion()) this.set(transform);
			else fly(transform, plotMiddle(), false);
		},
		zoomBy(factor, around) {
			land();
			const point = around ?? plotMiddle();
			const target = constrain(hold(clampScale(current.k * factor), invert(current, point), point));
			if (options.reducedMotion()) apply(target, true);
			else fly(target, point, true);
		},
		zoomInto(factor, at) {
			land();
			const middle = plotMiddle();
			const target = constrain(hold(clampScale(current.k * factor), invert(current, at), middle));
			if (options.reducedMotion()) apply(target, true);
			else fly(target, middle, true);
		},
		destroy() {
			land();
			clearTimeout(settleTimer);
			release();
			element.removeEventListener('pointerdown', onPointerDown);
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerup', onPointerEnd);
			element.removeEventListener('pointercancel', onPointerEnd);
			element.removeEventListener('wheel', onWheel);
			listeners.clear();
		},
	};
}
