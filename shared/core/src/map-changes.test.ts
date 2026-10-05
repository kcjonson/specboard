import { describe, expect, it } from 'vitest';
import { decodeMapChanges, encodeMapChanges, type MapChanges } from './map-changes.ts';

const READ: MapChanges = {
	baseline: 1_790_000_000_123,
	readAt: 1_790_100_000_456,
	changes: [
		{ key: 'SPE-12', kind: 'finished', at: 1_790_010_000_000 },
		{ key: 'SPE-12', kind: 'pr_opened', at: 1_790_020_000_000 },
		{ key: 'SPE-240', kind: 'filed', at: 1_790_030_000_789 },
	],
};

describe('the changes on the wire', () => {
	it('decodes to exactly the changes it encoded', () => {
		const wire = JSON.parse(JSON.stringify(encodeMapChanges(READ, 'SPE')));

		expect(decodeMapChanges(wire)).toEqual(READ);
	});

	it('keeps a first visit as a null baseline with no changes', () => {
		const first: MapChanges = { baseline: null, readAt: 1_790_100_000_000, changes: [] };

		expect(decodeMapChanges(JSON.parse(JSON.stringify(encodeMapChanges(first, 'SPE'))))).toEqual(first);
	});

	it('sends item keys as numbers under the project key', () => {
		const wire = encodeMapChanges(READ, 'SPE');

		expect(wire.projectKey).toBe('SPE');
		expect(wire.number).toEqual([12, 12, 240]);
	});

	it('refuses a key that is not canonical in the project', () => {
		expect(() => encodeMapChanges({ ...READ, changes: [{ key: 'SPE-012', kind: 'filed', at: 1 }] }, 'SPE')).toThrow();
		expect(() => encodeMapChanges({ ...READ, changes: [{ key: 'OTHER-1', kind: 'filed', at: 1 }] }, 'SPE')).toThrow();
	});
});
