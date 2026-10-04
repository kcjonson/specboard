/**
 * The minimap's panel: shown only when the frame has one, marking the viewport, and
 * turning a click or drag into a layout point for the camera.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { drawDot } from '../draw-dot.fixture';
import type { MapBounds } from '../layout/types';
import { EMPTY_OVERLAY, OverlayStore, type MinimapFrame } from '../overlay';
import { Minimap } from './Minimap';
import { minimapPanel, minimapSize, minimapViewport, toMinimap } from './minimap';

const bounds: MapBounds = { minX: -1000, maxX: 200, minY: -150, maxY: 150 };
const plot = { width: 1200, height: 700 };
const size = minimapSize(bounds);

function frameAt(transform: { k: number; x: number; y: number }): MinimapFrame {
	return {
		panel: minimapPanel(size, plot),
		size,
		bounds,
		viewport: minimapViewport(size, bounds, transform, plot),
		dots: [drawDot('A', -500, 0)],
	};
}

beforeEach(() => {
	// jsdom has neither pointer capture nor layout.
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 100, y: 200, left: 100, top: 200, right: 100 + size.width, bottom: 200 + size.height, width: size.width, height: size.height, toJSON: () => ({}),
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Minimap', () => {
	it('draws nothing while the camera is at fit all', () => {
		const store = new OverlayStore();
		const { container } = render(<Minimap store={store} onCenter={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});

	it('sits where the surface reserved it, marks the viewport, and follows a pan with the rectangle alone', () => {
		const store = new OverlayStore();
		const { container } = render(<Minimap store={store} onCenter={vi.fn()} />);
		const transform = { k: 3, x: -400, y: 100 };
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: frameAt(transform) }));
		const panel = container.firstChild as HTMLElement;
		const reserved = minimapPanel(size, plot);
		expect(panel.style.left).toBe(`${reserved.x}px`);
		expect(panel.style.top).toBe(`${reserved.y}px`);
		expect(panel.style.width).toBe(`${reserved.w}px`);
		expect(panel.getAttribute('aria-hidden')).toBe('true');

		const marker = panel.lastChild as HTMLElement;
		const marked = minimapViewport(size, bounds, transform, plot);
		expect(marker.style.width).toBe(`${marked.w}px`);
		expect(marker.style.transform).toBe(`translate(${marked.x}px, ${marked.y}px)`);

		const moved = { k: 3, x: -600, y: 100 };
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: frameAt(moved) }));
		expect((container.firstChild as HTMLElement).lastChild as HTMLElement).toBe(marker);
		expect(marker.style.transform).toBe(`translate(${minimapViewport(size, bounds, moved, plot).x}px, ${marked.y}px)`);
	});

	it('goes away again when the camera comes back out to fit all', () => {
		const store = new OverlayStore();
		const { container } = render(<Minimap store={store} onCenter={vi.fn()} />);
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: frameAt({ k: 3, x: 0, y: 0 }) }));
		expect(container.firstChild).not.toBeNull();
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: null }));
		expect(container.firstChild).toBeNull();
	});

	it('sends the layout point under a click, flying, and under a drag, not flying', () => {
		const store = new OverlayStore();
		const onCenter = vi.fn();
		const { container } = render(<Minimap store={store} onCenter={onCenter} />);
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: frameAt({ k: 3, x: -400, y: 100 }) }));
		const panel = container.firstChild as HTMLElement;

		// The miniature's top left is the Map's, and its middle is the Map's middle.
		fireEvent.pointerDown(panel, { clientX: 100, clientY: 200, pointerId: 1 });
		expect(onCenter).toHaveBeenLastCalledWith({ x: bounds.minX, y: bounds.minY }, true);
		fireEvent.pointerMove(panel, { clientX: 100 + size.width / 2, clientY: 200 + size.height / 2, pointerId: 1 });
		const [point, fly] = onCenter.mock.lastCall!;
		expect(fly).toBe(false);
		expect(point.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2);
		expect(point.y).toBeCloseTo((bounds.minY + bounds.maxY) / 2);

		// A press past the miniature's edge lands on the Map's edge.
		fireEvent.pointerDown(panel, { clientX: 100 + size.width + 50, clientY: 200 + size.height + 50, pointerId: 1 });
		expect(onCenter).toHaveBeenLastCalledWith({ x: bounds.maxX, y: bounds.maxY }, true);
	});

	it('maps the miniature to the viewport rectangle it draws: what a click on the rectangle\'s middle centers is the plot\'s middle', () => {
		const transform = { k: 3, x: -400, y: 100 };
		const marked = minimapViewport(size, bounds, transform, plot);
		const store = new OverlayStore();
		const onCenter = vi.fn();
		const { container } = render(<Minimap store={store} onCenter={onCenter} />);
		act(() => store.publish({ ...EMPTY_OVERLAY, minimap: frameAt(transform) }));
		fireEvent.pointerDown(container.firstChild as HTMLElement, { clientX: 100 + marked.x + marked.w / 2, clientY: 200 + marked.y + marked.h / 2, pointerId: 1 });
		const [point] = onCenter.mock.lastCall!;
		const back = toMinimap(size, bounds, point);
		expect(back.x).toBeCloseTo(marked.x + marked.w / 2);
		expect(back.y).toBeCloseTo(marked.y + marked.h / 2);
	});
});
