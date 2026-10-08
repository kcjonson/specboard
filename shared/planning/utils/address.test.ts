import { describe, expect, it } from 'vitest';
import { withQuery } from './address';

const at = { pathname: '/planning', search: '?projects=acme/one,acme/two&view=map', hash: '' };

describe('withQuery', () => {
	it('sets a parameter in its place and appends a new one, leaving the rest as written', () => {
		expect(withQuery(at, { view: 'table' })).toBe('/planning?projects=acme/one,acme/two&view=table');
		expect(withQuery(at, { item: 'ONE-4' })).toBe('/planning?projects=acme/one,acme/two&view=map&item=ONE-4');
	});

	it('drops a parameter set to undefined, and the whole query once nothing is left', () => {
		expect(withQuery(at, { view: undefined, focus: undefined })).toBe('/planning?projects=acme/one,acme/two');
		expect(withQuery({ ...at, search: '?focus=SPE-1' }, { focus: undefined })).toBe('/planning');
	});

	it('encodes the values it writes, all but the slashes and commas a projects list is made of', () => {
		expect(withQuery(at, { search: 'oauth login & more' })).toBe('/planning?projects=acme/one,acme/two&view=map&search=oauth%20login%20%26%20more');
		expect(withQuery({ ...at, search: '?projects=Acme/One,%20acme/two' }, { projects: 'acme/one,acme/two' }))
			.toBe('/planning?projects=acme/one,acme/two');
	});

	it('keeps one of a parameter it changes, and every repeat of one it leaves alone', () => {
		expect(withQuery({ ...at, search: '?a=1&view=map&a=2&view=board' }, { view: 'table' })).toBe('/planning?a=1&view=table&a=2');
	});

	it('keeps the hash', () => {
		expect(withQuery({ ...at, hash: '#top' }, { view: 'board' })).toBe('/planning?projects=acme/one,acme/two&view=board#top');
	});
});
