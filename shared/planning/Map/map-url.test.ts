import { describe, expect, it } from 'vitest';
import { readFocus, urlWithFocus } from './map-url';

describe('map URLs', () => {
	it('reads the item ?focus= names, upper-cased like the planning route does', () => {
		expect(readFocus('?view=map&focus=SPE-123')).toBe('SPE-123');
		expect(readFocus('?focus=spe-9')).toBe('SPE-9');
	});

	it('ignores a missing or malformed anchor', () => {
		expect(readFocus('?view=map')).toBeNull();
		expect(readFocus('?focus=')).toBeNull();
		expect(readFocus('?focus=../etc')).toBeNull();
		expect(readFocus('?focus=SPE-')).toBeNull();
		expect(readFocus('?focus=SPE-0')).toBeNull();
		expect(readFocus('?focus=S-4')).toBeNull();
	});

	it('canonicalizes the number the way the shared parser does', () => {
		expect(readFocus('?focus=SPE-007')).toBe('SPE-7');
	});

	const at = { pathname: '/projects/acme/specboard/planning', search: '?view=map', hash: '#top' };

	it('sets the anchor and keeps the rest of the URL', () => {
		expect(urlWithFocus(at, 'SPE-4')).toBe('/projects/acme/specboard/planning?view=map&focus=SPE-4#top');
		expect(urlWithFocus({ ...at, search: '?view=map&focus=SPE-1' }, 'SPE-4')).toBe('/projects/acme/specboard/planning?view=map&focus=SPE-4#top');
	});

	it('drops the anchor, and the whole query when nothing else is left', () => {
		expect(urlWithFocus({ ...at, search: '?view=map&focus=SPE-1' }, null)).toBe('/projects/acme/specboard/planning?view=map#top');
		expect(urlWithFocus({ ...at, search: '?focus=SPE-1', hash: '' }, null)).toBe('/projects/acme/specboard/planning');
	});

	it('leaves the multi-project view\'s list of projects as written', () => {
		const combined = { pathname: '/planning', search: '?projects=acme/one,acme/two&view=map', hash: '' };
		expect(urlWithFocus(combined, 'ONE-3')).toBe('/planning?projects=acme/one,acme/two&view=map&focus=ONE-3');
	});
});
