/**
 * The Map's keys.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { mapKeyOf, type KeyEventLike, type MapKey } from './map-keys';

const press = (key: string, init: Partial<KeyEventLike> = {}): MapKey | null =>
	mapKeyOf({ key, code: '', altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, target: document.body, ...init });

/** Z is read from `code`: Option+Z types an omega on a Mac. */

describe('the Map\'s keys', () => {
	it('moves focus with the arrows', () => {
		expect(press('ArrowLeft')).toEqual({ kind: 'move', direction: 'left' });
		expect(press('ArrowRight')).toEqual({ kind: 'move', direction: 'right' });
		expect(press('ArrowUp')).toEqual({ kind: 'move', direction: 'up' });
		expect(press('ArrowDown')).toEqual({ kind: 'move', direction: 'down' });
	});

	it('uses Shift+Left and Shift+Right for the tree\'s collapse and expand, which plain arrows cannot be', () => {
		expect(press('ArrowLeft', { shiftKey: true })).toEqual({ kind: 'collapse' });
		expect(press('ArrowRight', { shiftKey: true })).toEqual({ kind: 'expand' });
		expect(press('ArrowUp', { shiftKey: true })).toBeNull();
		expect(press('ArrowDown', { shiftKey: true })).toBeNull();
	});

	it('opens on Enter', () => {
		expect(press('Enter')).toEqual({ kind: 'open' });
		expect(press('Enter', { shiftKey: true })).toBeNull();
	});

	it('zooms around the focused dot on + and -, with or without Shift, and on = for the unshifted +', () => {
		expect(press('+', { shiftKey: true })).toEqual({ kind: 'zoom-focus', direction: 'in' });
		expect(press('+')).toEqual({ kind: 'zoom-focus', direction: 'in' });
		expect(press('=')).toEqual({ kind: 'zoom-focus', direction: 'in' });
		expect(press('-')).toEqual({ kind: 'zoom-focus', direction: 'out' });
	});

	it('fits all on 0, jumps to now on T, and fits the focused family on F, in either case', () => {
		expect(press('0')).toEqual({ kind: 'fit-all' });
		expect(press('t')).toEqual({ kind: 'now' });
		expect(press('T')).toEqual({ kind: 'now' });
		expect(press('f')).toEqual({ kind: 'fit-focus' });
		expect(press('F')).toEqual({ kind: 'fit-focus' });
	});

	it('steps through what needs a person on P and live sessions on L, backwards with Shift', () => {
		expect(press('p')).toEqual({ kind: 'needs', delta: 1 });
		expect(press('P', { shiftKey: true })).toEqual({ kind: 'needs', delta: -1 });
		expect(press('l')).toEqual({ kind: 'live', delta: 1 });
		expect(press('L', { shiftKey: true })).toEqual({ kind: 'live', delta: -1 });
	});

	it('steps through the bar on ] and [', () => {
		expect(press(']')).toEqual({ kind: 'step', delta: 1 });
		expect(press('[')).toEqual({ kind: 'step', delta: -1 });
	});

	it('leaves Cmd and Ctrl chords alone', () => {
		for (const key of ['p', 'l', 't', 'f', '0', '+', '-', ']', '[', 'ArrowLeft', 'Enter']) {
			expect(press(key, { metaKey: true })).toBeNull();
			expect(press(key, { ctrlKey: true })).toBeNull();
		}
	});

	it('takes nothing with Option', () => {
		for (const key of ['p', 'l', 't', 'f', '0', ']', 'ArrowLeft', 'Enter']) expect(press(key, { altKey: true })).toBeNull();
	});

	it('stays out of the way while the person is typing', () => {
		const editable = document.createElement('div');
		Object.defineProperty(editable, 'isContentEditable', { value: true });
		const fields = [...['input', 'textarea', 'select'].map((tag) => document.createElement(tag)), editable];
		for (const target of fields) {
			expect(press('p', { target })).toBeNull();
			expect(press('ArrowLeft', { target })).toBeNull();
			expect(press('Enter', { target })).toBeNull();
		}
	});

	// The planning page's own keys (spec, Keys): none of them may mean something else on the Map.
	it('claims none of the planning page\'s keys: N, C, /, ?, M, E, and 1 to 3', () => {
		for (const key of ['n', 'N', 'c', 'C', '/', '?', 'm', 'M', 'e', 'E', '1', '2', '3']) {
			expect(press(key)).toBeNull();
			expect(press(key, { shiftKey: true })).toBeNull();
		}
		expect(press('k', { metaKey: true })).toBeNull();
		expect(press('K', { ctrlKey: true })).toBeNull();
	});

	it('ignores every other key, Escape included, which the page\'s own ladder owns', () => {
		for (const key of ['Escape', 'Tab', ' ', 'a', 'z', 'x', '4', 'Home', 'End']) expect(press(key)).toBeNull();
	});
});
