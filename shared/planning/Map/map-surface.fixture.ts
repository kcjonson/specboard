import { vi } from 'vitest';
import type { Transform, Viewport } from './camera';
import type { MapCamera, ScreenPoint } from './map-camera';
import { MapSurface } from './map-surface';
import { OverlayStore } from './overlay';
import { RULER_HEIGHT, type MapFrame, type MapRenderer } from './renderer';

/** A camera and renderer that record what they are told, and a surface wired to them, for tests that drive the Map without a canvas. */

export class FakeCamera implements MapCamera {
	transform: Transform = { k: 1, x: 0, y: 0 };
	listeners = new Set<() => void>();
	configured: { viewport: Viewport; minScale: number } | null = null;
	flights: Transform[] = [];
	zooms: Array<{ factor: number; around?: ScreenPoint }> = [];

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	configure(viewport: Viewport, _bounds: unknown, minScale: number): void {
		this.configured = { viewport, minScale };
	}

	set(transform: Transform): void {
		this.transform = transform;
		for (const listener of this.listeners) listener();
	}

	flyTo(transform: Transform): void {
		this.flights.push(transform);
		this.set(transform);
	}

	zoomBy(factor: number, around?: ScreenPoint): void {
		this.zooms.push({ factor, around });
	}

	destroy(): void {
		this.listeners.clear();
	}
}

export class FakeRenderer implements MapRenderer {
	frames: MapFrame[] = [];
	size = { width: 0, height: 0 };
	themeReads = 0;

	resize(width: number, height: number): void {
		this.size = { width, height };
	}

	refreshTheme(): void {
		this.themeReads++;
	}

	measureLabel(text: string): number {
		return text.length * 7;
	}

	draw(frame: MapFrame): void {
		this.frames.push(frame);
	}
}

export function setup(): {
	surface: MapSurface;
	camera: FakeCamera;
	renderer: FakeRenderer;
	overlay: OverlayStore;
	clock: { now: number; reduced: boolean };
	frames: Array<() => void>;
	empty: ReturnType<typeof vi.fn>;
	settle: ReturnType<typeof vi.fn>;
	open: ReturnType<typeof vi.fn>;
	collapse: ReturnType<typeof vi.fn>;
	target: ReturnType<typeof vi.fn>;
	flush: () => void;
	deferred: Array<() => void>;
} {
	const camera = new FakeCamera();
	const renderer = new FakeRenderer();
	const frames: Array<() => void> = [];
	const deferred: Array<() => void> = [];
	const empty = vi.fn();
	const settle = vi.fn();
	const open = vi.fn();
	const collapse = vi.fn();
	const target = vi.fn();
	const overlay = new OverlayStore();
	const clock = { now: 0, reduced: false };
	const surface = new MapSurface(
		{
			renderer,
			camera,
			overlay,
			now: () => clock.now,
			reducedMotion: () => clock.reduced,
			schedule: (paint) => frames.push(paint),
			defer: (task) => deferred.push(task),
			timeZone: 'UTC',
		},
		{ onViewportEmpty: empty, onSettle: settle, onOpen: open, onCollapse: collapse, onPointerTarget: target },
	);
	return { surface, camera, renderer, overlay, clock, frames, empty, settle, open, collapse, target, deferred, flush: () => frames.splice(0).forEach((paint) => paint()) };
}

export const WIDTH = 1000;
export const HEIGHT = 500 + RULER_HEIGHT;
export const plot: Viewport = { width: WIDTH, height: 500 };
