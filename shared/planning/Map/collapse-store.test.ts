import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test-support/memory-storage';
import { mapCollapsePref } from '../Planning/prefs';
import { createCollapseStore } from './collapse-store';

beforeEach(() => {
	vi.unstubAllGlobals();
	vi.stubGlobal('localStorage', memoryStorage());
});

describe('collapse store', () => {
	it('keeps choices per project', () => {
		const one = createCollapseStore('acme/specboard');
		const other = createCollapseStore('acme/other');
		one.write({ 'SPE-1': true, 'SPE-2': false });
		expect(one.read()).toEqual({ 'SPE-1': true, 'SPE-2': false });
		expect(other.read()).toEqual({});
		expect(globalThis.localStorage.getItem(mapCollapsePref('acme/specboard'))).toBe('{"SPE-1":true,"SPE-2":false}');
	});

	it('reads a garbled or foreign entry as no choices, keeping what is well formed', () => {
		const store = createCollapseStore('acme/specboard');
		const key = mapCollapsePref('acme/specboard');
		globalThis.localStorage.setItem(key, '{not json');
		expect(store.read()).toEqual({});
		globalThis.localStorage.setItem(key, '[true]');
		expect(store.read()).toEqual({});
		globalThis.localStorage.setItem(key, '{"SPE-1":true,"SPE-2":"yes"}');
		expect(store.read()).toEqual({ 'SPE-1': true });
	});

	it('falls back to no choices when storage is blocked, and drops the write', () => {
		const blocked = (): never => {
			throw new Error('blocked');
		};
		vi.stubGlobal('localStorage', { ...memoryStorage(), getItem: blocked, setItem: blocked });
		const store = createCollapseStore('acme/specboard');
		expect(store.read()).toEqual({});
		expect(() => store.write({ 'SPE-1': true })).not.toThrow();
	});
});
