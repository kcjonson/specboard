/**
 * Draft persistence is keyed by the project's immutable id, never its slug — the slug
 * is user-editable and unique only per owner, so slug keys collided across accounts on
 * a shared browser and were orphaned on rename.
 *
 * The empty-id cases matter because the id is resolved asynchronously: a document
 * opened before it arrives must simply not persist, rather than writing under a key
 * that belongs to no project and that nothing will ever read back.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	saveToLocalStorage,
	loadFromLocalStorage,
	hasPersistedContent,
	clearLocalStorage,
	getPersistedTimestamp,
} from './documentPersistence';
import type { SlateContent } from './DocumentModel';

const store = (() => {
	let data: Record<string, string> = {};
	return {
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => { data[k] = v; },
		removeItem: (k: string) => { delete data[k]; },
		clear: () => { data = {}; },
		key: (i: number) => Object.keys(data)[i] ?? null,
		get length() { return Object.keys(data).length; },
		snapshot: () => ({ ...data }),
	};
})();
Object.defineProperty(globalThis, 'localStorage', { value: store, writable: true });

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const PATH = '/docs/readme.md';
const CONTENT = [{ type: 'paragraph', children: [{ text: 'draft' }] }] as unknown as SlateContent;

beforeEach(() => store.clear());

describe('documentPersistence', () => {
	it('round-trips a draft under the project id', () => {
		saveToLocalStorage(PROJECT_ID, PATH, CONTENT);
		expect(hasPersistedContent(PROJECT_ID, PATH)).toBe(true);
		expect(loadFromLocalStorage(PROJECT_ID, PATH)?.content).toEqual(CONTENT);
	});

	it('keys by the project id, so two projects never see each other drafts', () => {
		saveToLocalStorage(PROJECT_ID, PATH, CONTENT);
		expect(hasPersistedContent(OTHER_PROJECT_ID, PATH)).toBe(false);
		expect(loadFromLocalStorage(OTHER_PROJECT_ID, PATH)).toBeNull();
	});

	it('puts the project id in the storage key', () => {
		saveToLocalStorage(PROJECT_ID, PATH, CONTENT);
		const [key] = Object.keys(store.snapshot());
		expect(key).toContain(PROJECT_ID);
	});

	// The id is resolved asynchronously; before it lands the caller passes ''.
	describe('when the project id has not resolved yet', () => {
		it('writes nothing rather than using an empty key', () => {
			saveToLocalStorage('', PATH, CONTENT);
			expect(store.snapshot()).toEqual({});
		});

		it('reports no persisted content', () => {
			saveToLocalStorage(PROJECT_ID, PATH, CONTENT);
			expect(hasPersistedContent('', PATH)).toBe(false);
			expect(loadFromLocalStorage('', PATH)).toBeNull();
			expect(getPersistedTimestamp('', PATH)).toBeNull();
		});

		it('clearing is a no-op that cannot touch a real project draft', () => {
			saveToLocalStorage(PROJECT_ID, PATH, CONTENT);
			clearLocalStorage('', PATH);
			expect(hasPersistedContent(PROJECT_ID, PATH)).toBe(true);
		});
	});

	it('survives localStorage throwing', () => {
		const spy = vi.spyOn(store, 'setItem').mockImplementation(() => { throw new Error('quota'); });
		expect(() => saveToLocalStorage(PROJECT_ID, PATH, CONTENT)).not.toThrow();
		spy.mockRestore();
	});
});
