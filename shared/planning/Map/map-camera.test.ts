/**
 * The camera every gesture, flight, zoom, and stepping-bar pan goes through: drag, pinch, the
 * wheel in each of its units, the limits it holds them to, and flights that any input cuts.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SCALE, cubicBezier, type Transform } from './camera';
import { createCamera, flightPath, type CameraOptions, type MapCamera } from './map-camera';
import { installPointerEvents } from '../test-support/pointer-events';

installPointerEvents();

let made: MapCamera[] = [];
let element: HTMLElement;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
	element = document.createElement('div');
	document.body.appendChild(element);
	// The plot sits 10 px in from the page's corner, so screen points are client points less that.
	vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 810, bottom: 610, width: 800, height: 600, toJSON: () => ({}) });
});

afterEach(() => {
	for (const camera of made) camera.destroy();
	made = [];
	element.remove();
	vi.useRealTimers();
});

const BOUNDS = { minX: 0, maxX: 1000, minY: 0, maxY: 500 };

function camera(options: Partial<CameraOptions> = {}, bounded = false): MapCamera {
	const instance = createCamera(element, { reducedMotion: () => false, onSettle: () => {}, ...options });
	instance.configure({ width: 800, height: 600 }, bounded ? BOUNDS : null, 0.25);
	instance.set({ k: 1, x: 0, y: 0 });
	made.push(instance);
	return instance;
}

const pointer = (type: string, x: number, y: number, init: { pointerId?: number; pointerType?: string; button?: number; ctrlKey?: boolean } = {}): void => {
	element.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x + 10, clientY: y + 10, button: 0, ...init }));
};

const wheel = (init: NonNullable<ConstructorParameters<typeof WheelEvent>[1]> & { x?: number; y?: number }): WheelEvent => {
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: (init.x ?? 0) + 10, clientY: (init.y ?? 0) + 10, ...init });
	element.dispatchEvent(event);
	return event;
};

/** The layout point under a screen point. */
const under = (t: Transform, x: number, y: number): { x: number; y: number } => ({ x: (x - t.x) / t.k, y: (y - t.y) / t.k });

describe('flights', () => {
	it('lands at once under reduced motion', () => {
		const c = camera({ reducedMotion: () => true });
		c.flyTo({ k: 2, x: -120, y: 40 });
		expect(c.transform).toEqual({ k: 2, x: -120, y: 40 });
		expect(c.flying).toBe(false);
	});

	it('zooms by a step at once under reduced motion, about the point it is given', () => {
		const c = camera({ reducedMotion: () => true });
		c.zoomBy(2, { x: 100, y: 100 });
		expect(c.transform).toEqual({ k: 2, x: -100, y: -100 });
	});

	it('flies over 450 ms, eased, and lands exactly where it was sent', () => {
		const c = camera();
		const target = { k: 1, x: -400, y: 0 };
		c.flyTo(target);
		expect(c.transform).toEqual({ k: 1, x: 0, y: 0 });
		expect(c.flying).toBe(true);
		vi.advanceTimersByTime(112);
		// A quarter of the way through the time, on the cubic-bezier(.2, 0, 0, 1) curve, which front-loads the move.
		const expected = flightPath({ k: 1, x: 0, y: 0 }, target, { x: 400, y: 300 }, 800)(cubicBezier(0.2, 0, 0, 1)(112 / 450));
		expect(c.transform.x).toBeCloseTo(expected.x);
		expect(c.transform.k).toBeCloseTo(expected.k);
		expect(cubicBezier(0.2, 0, 0, 1)(112 / 450)).toBeGreaterThan(0.5);
		expect(c.flying).toBe(true);
		vi.advanceTimersByTime(400);
		expect(c.transform).toEqual(target);
		expect(c.flying).toBe(false);
	});

	it('backs out on a long move and comes back in, as d3 did', () => {
		const path = flightPath({ k: 2, x: 0, y: 0 }, { k: 2, x: -4000, y: 0 }, { x: 400, y: 300 }, 800);
		expect(path(0)).toEqual({ k: 2, x: 0, y: 0 });
		expect(path(0.5).k).toBeLessThan(2);
		expect(path(1).k).toBeCloseTo(2);
		expect(path(1).x).toBeCloseTo(-4000);
	});

	it('holds the point it zooms about still the whole way', () => {
		const from = { k: 1, x: 0, y: 0 };
		const path = flightPath(from, { k: 4, x: -300, y: -600 }, { x: 100, y: 200 }, 800);
		for (const t of [0.25, 0.5, 0.75]) {
			const at = path(t);
			expect(under(at, 100, 200).x).toBeCloseTo(100);
			expect(under(at, 100, 200).y).toBeCloseTo(200);
		}
	});

	it('is cut short where it is by a wheel, a press, or another move', () => {
		for (const interrupt of [
			(): unknown => wheel({ deltaY: 0 }),
			(): void => pointer('pointerdown', 50, 50),
			(c: MapCamera): void => c.set({ k: 1, x: 5, y: 5 }),
		]) {
			const c = camera();
			c.flyTo({ k: 1, x: -400, y: 0 });
			vi.advanceTimersByTime(100);
			interrupt(c);
			pointer('pointerup', 50, 50);
			expect(c.flying).toBe(false);
			const stopped = c.transform;
			vi.advanceTimersByTime(500);
			expect(c.transform).toEqual(stopped);
			c.destroy();
		}
	});

	it('settles after a zoom the person asked for lands, and never after a flight to a place', () => {
		const settled = vi.fn();
		const c = camera({ onSettle: settled });
		c.flyTo({ k: 2, x: 0, y: 0 });
		vi.advanceTimersByTime(1000);
		expect(settled).not.toHaveBeenCalled();
		c.zoomBy(1.4);
		vi.advanceTimersByTime(450);
		expect(settled).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(settled).toHaveBeenCalledTimes(1);
	});
});

describe('the wheel', () => {
	it('pans by pixels, lines, and pages, and takes the event from the page', () => {
		const c = camera();
		const event = wheel({ deltaX: 30, deltaY: 20 });
		expect(event.defaultPrevented).toBe(true);
		expect(c.transform).toEqual({ k: 1, x: -30, y: -20 });
		wheel({ deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
		expect(c.transform).toEqual({ k: 1, x: -30, y: -52 });
		wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
		expect(c.transform).toEqual({ k: 1, x: -30, y: -652 });
	});

	it('zooms about the pointer with ctrl (a trackpad pinch) and cmd', () => {
		const c = camera();
		wheel({ deltaY: -50, ctrlKey: true, x: 200, y: 150 });
		// 2^(50 * 0.002 * 10): a pinch counts ten times what a held key does.
		expect(c.transform.k).toBeCloseTo(2);
		expect(under(c.transform, 200, 150).x).toBeCloseTo(200);
		expect(under(c.transform, 200, 150).y).toBeCloseTo(150);
		wheel({ deltaY: 500, metaKey: true, x: 200, y: 150 });
		expect(c.transform.k).toBeCloseTo(1);
		expect(under(c.transform, 200, 150).x).toBeCloseTo(200);
	});

	it('zooms by lines and pages at their own rates', () => {
		const c = camera();
		wheel({ deltaY: -20, deltaMode: WheelEvent.DOM_DELTA_LINE, metaKey: true });
		expect(c.transform.k).toBeCloseTo(2);
		wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE, metaKey: true });
		expect(c.transform.k).toBeCloseTo(1);
	});

	it('stops zooming at the limits, and still keeps the page from zooming', () => {
		const c = camera();
		wheel({ deltaY: 5000, ctrlKey: true });
		expect(c.transform.k).toBe(0.25);
		const event = wheel({ deltaY: 100, ctrlKey: true });
		expect(event.defaultPrevented).toBe(true);
		expect(c.transform.k).toBe(0.25);
		wheel({ deltaY: -5000, ctrlKey: true });
		expect(c.transform.k).toBe(MAX_SCALE);
	});

	it('settles once the person stops', () => {
		const settled = vi.fn();
		camera({ onSettle: settled });
		wheel({ deltaY: 10 });
		vi.advanceTimersByTime(200);
		wheel({ deltaY: 10 });
		vi.advanceTimersByTime(200);
		expect(settled).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(settled).toHaveBeenCalledTimes(1);
	});
});

describe('the extent', () => {
	it('stops a pan when the middle of the plot reaches the edge of the Map', () => {
		const c = camera({}, true);
		c.set({ k: 1, x: -100, y: 50 });
		wheel({ deltaX: -5000 });
		// The middle of the plot (400, 300) is over the Map's left edge.
		expect(under(c.transform, 400, 300).x).toBeCloseTo(0);
		wheel({ deltaX: 5000, deltaY: 5000 });
		expect(under(c.transform, 400, 300)).toEqual({ x: 1000, y: 500 });
	});

	it('holds a drag and a zoom to it as well', () => {
		const c = camera({}, true);
		c.set({ k: 1, x: -100, y: 50 });
		pointer('pointerdown', 400, 300);
		pointer('pointermove', 2000, 300);
		expect(under(c.transform, 400, 300).x).toBeCloseTo(0);
		pointer('pointerup', 2000, 300);
		wheel({ deltaY: 300, ctrlKey: true, x: 0, y: 0 });
		expect(under(c.transform, 400, 300).x).toBeGreaterThanOrEqual(0);
	});

	it('takes the zoom-out limit it is given', () => {
		const c = camera();
		c.configure({ width: 800, height: 600 }, null, 0.5);
		c.zoomBy(0.1);
		vi.advanceTimersByTime(500);
		expect(c.transform.k).toBe(0.5);
	});
});

describe('pointers', () => {
	it('pans with a drag, holding what was pressed under the pointer', () => {
		const settled = vi.fn();
		const c = camera({ onSettle: settled });
		pointer('pointerdown', 100, 100);
		pointer('pointermove', 130, 90);
		expect(c.transform).toEqual({ k: 1, x: 30, y: -10 });
		pointer('pointermove', 160, 140);
		expect(c.transform).toEqual({ k: 1, x: 60, y: 40 });
		pointer('pointerup', 160, 140);
		pointer('pointermove', 300, 300);
		expect(c.transform).toEqual({ k: 1, x: 60, y: 40 });
		vi.advanceTimersByTime(300);
		expect(settled).toHaveBeenCalledTimes(1);
	});

	it('pans with a pen and a finger the same way', () => {
		for (const pointerType of ['pen', 'touch']) {
			const c = camera();
			pointer('pointerdown', 100, 100, { pointerType });
			pointer('pointermove', 80, 100, { pointerType });
			pointer('pointerup', 80, 100, { pointerType });
			expect(c.transform).toEqual({ k: 1, x: -20, y: 0 });
			c.destroy();
		}
	});

	it('leaves a press the Map claims alone', () => {
		const claims = vi.fn(() => true);
		const c = camera({ claims });
		pointer('pointerdown', 100, 100);
		pointer('pointermove', 140, 100);
		pointer('pointermove', 180, 100);
		pointer('pointerup', 180, 100);
		expect(claims).toHaveBeenCalledTimes(1);
		expect(c.transform).toEqual({ k: 1, x: 0, y: 0 });
	});

	it('asks whether a press is claimed only once it moves, after the press has been seen', () => {
		let claimed = false;
		const c = camera({ claims: () => claimed });
		element.addEventListener('pointerdown', () => (claimed = true));
		pointer('pointerdown', 100, 100);
		pointer('pointermove', 140, 100);
		expect(c.transform).toEqual({ k: 1, x: 0, y: 0 });
	});

	it('does not pan on another button or a ctrl-click', () => {
		const c = camera();
		pointer('pointerdown', 100, 100, { button: 2 });
		pointer('pointermove', 140, 100);
		pointer('pointerup', 140, 100);
		pointer('pointerdown', 100, 100, { ctrlKey: true });
		pointer('pointermove', 140, 100);
		pointer('pointerup', 140, 100);
		expect(c.transform).toEqual({ k: 1, x: 0, y: 0 });
	});

	it('pinches with two fingers about their middle, and pans on when one lifts', () => {
		const c = camera();
		const touch = { pointerType: 'touch' };
		pointer('pointerdown', 300, 300, { ...touch, pointerId: 1 });
		pointer('pointerdown', 500, 300, { ...touch, pointerId: 2 });
		// The fingers spread to twice as far apart, about the same middle.
		pointer('pointermove', 200, 300, { ...touch, pointerId: 1 });
		pointer('pointermove', 600, 300, { ...touch, pointerId: 2 });
		expect(c.transform.k).toBeCloseTo(2);
		expect(under(c.transform, 400, 300)).toEqual({ x: 400, y: 300 });
		// What was under each finger is still under it.
		expect(under(c.transform, 200, 300).x).toBeCloseTo(300);
		expect(under(c.transform, 600, 300).x).toBeCloseTo(500);

		pointer('pointerup', 600, 300, { ...touch, pointerId: 2 });
		pointer('pointermove', 250, 300, { ...touch, pointerId: 1 });
		expect(c.transform.k).toBeCloseTo(2);
		expect(under(c.transform, 250, 300).x).toBeCloseTo(300);
	});

	it('holds a pinch to the zoom limits', () => {
		const c = camera();
		const touch = { pointerType: 'touch' };
		pointer('pointerdown', 300, 300, { ...touch, pointerId: 1 });
		pointer('pointerdown', 500, 300, { ...touch, pointerId: 2 });
		pointer('pointermove', 399, 300, { ...touch, pointerId: 1 });
		pointer('pointermove', 401, 300, { ...touch, pointerId: 2 });
		expect(c.transform.k).toBe(0.25);
	});

	it('lets go of everything when it is destroyed', () => {
		const c = camera();
		const listener = vi.fn();
		c.onChange(listener);
		c.destroy();
		pointer('pointerdown', 100, 100);
		pointer('pointermove', 140, 100);
		wheel({ deltaY: 10 });
		expect(listener).not.toHaveBeenCalled();
	});
});
