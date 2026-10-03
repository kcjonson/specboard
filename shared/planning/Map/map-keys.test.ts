/**
 * The Map's zoom keys.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { zoomKeyOf } from './map-keys';

const press = (init: Partial<Parameters<typeof zoomKeyOf>[0]> = {}): ReturnType<typeof zoomKeyOf> =>
	zoomKeyOf({ code: 'KeyZ', altKey: false, metaKey: false, ctrlKey: false, target: document.body, ...init });

describe('zoom keys', () => {
	it('zoom in on Z', () => {
		expect(press()).toBe('in');
	});

	it('zoom out on Option+Z, which types an omega on a Mac', () => {
		expect(press({ altKey: true })).toBe('out');
	});

	it('leave Cmd+Z and Ctrl+Z alone, with or without Option', () => {
		expect(press({ metaKey: true })).toBeNull();
		expect(press({ ctrlKey: true })).toBeNull();
		expect(press({ metaKey: true, altKey: true })).toBeNull();
	});

	it('ignore every other key', () => {
		expect(press({ code: 'KeyX' })).toBeNull();
		expect(press({ code: 'Equal' })).toBeNull();
	});

	it('stay out of the way while the person is typing', () => {
		for (const tag of ['input', 'textarea', 'select']) {
			expect(press({ target: document.createElement(tag) })).toBeNull();
		}
		const editable = document.createElement('div');
		Object.defineProperty(editable, 'isContentEditable', { value: true });
		expect(press({ target: editable })).toBeNull();
	});
});
