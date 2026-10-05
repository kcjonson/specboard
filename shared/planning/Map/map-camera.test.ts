/**
 * The camera every flight, zoom, and stepping-bar pan goes through: under reduced motion they
 * all land at once.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createCamera, type MapCamera } from './map-camera';

let made: MapCamera[] = [];
afterEach(() => {
	for (const camera of made) camera.destroy();
	made = [];
});

function camera(reduced: boolean): MapCamera {
	const element = document.createElement('div');
	document.body.appendChild(element);
	const instance = createCamera(element, { reducedMotion: () => reduced, onSettle: () => {} });
	instance.configure({ width: 800, height: 600 }, null, 0.01);
	made.push(instance);
	return instance;
}

describe('the camera', () => {
	it('lands a flight at once under reduced motion', () => {
		const c = camera(true);
		c.flyTo({ k: 2, x: -120, y: 40 });
		expect(c.transform).toEqual({ k: 2, x: -120, y: 40 });
	});

	it('zooms by a step at once under reduced motion, about the point it is given', () => {
		const c = camera(true);
		c.set({ k: 1, x: 0, y: 0 });
		c.zoomBy(2, { x: 100, y: 100 });
		expect(c.transform).toEqual({ k: 2, x: -100, y: -100 });
	});

	it('flies, and does not land at once, otherwise', () => {
		const c = camera(false);
		c.flyTo({ k: 2, x: -120, y: 40 });
		expect(c.transform).toEqual({ k: 1, x: 0, y: 0 });
	});
});
