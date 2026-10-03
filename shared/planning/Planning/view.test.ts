/**
 * Which planning view shows: the URL, the remembered pick, and the small-screen fallback.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test-support/memory-storage';
import { VIEW_PREF } from './prefs';
import { readView, resolveView } from './view';

function at(search: string, stored?: string): void {
	window.history.replaceState(null, '', `/projects/acme/specboard/planning${search}`);
	globalThis.localStorage.clear();
	if (stored !== undefined) globalThis.localStorage.setItem(VIEW_PREF, stored);
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	at('');
});

describe('readView', () => {
	it('accepts every view in ?view=', () => {
		at('?view=board');
		expect(readView()).toBe('board');
		at('?view=table');
		expect(readView()).toBe('table');
		at('?view=map');
		expect(readView()).toBe('map');
	});

	it('lets an explicit ?view= win over the remembered one', () => {
		at('?view=table', 'map');
		expect(readView()).toBe('table');
		at('?view=map', 'table');
		expect(readView()).toBe('map');
	});

	it('remembers the Map like the other views', () => {
		at('', 'map');
		expect(readView()).toBe('map');
		at('?highlight=abc', 'table');
		expect(readView()).toBe('table');
	});

	it('falls back to the board when there is nothing to go on, or nothing valid', () => {
		at('');
		expect(readView()).toBe('board');
		at('?view=gantt');
		expect(readView()).toBe('board');
		at('?view=gantt', 'kanban');
		expect(readView()).toBe('board');
	});
});

describe('resolveView', () => {
	it('shows the Board when the Map is asked for on a small screen', () => {
		expect(resolveView('map', true)).toBe('board');
	});

	it('shows what was asked for otherwise', () => {
		expect(resolveView('map', false)).toBe('map');
		expect(resolveView('table', true)).toBe('table');
		expect(resolveView('board', true)).toBe('board');
	});
});
