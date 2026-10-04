import { describe, expect, it } from 'vitest';
import { linkAtRest, linkCurve } from './links';

describe('link curves', () => {
	it('flows chain links and agent lines horizontally: the ends leave and arrive level', () => {
		for (const kind of ['chain', 'agent'] as const) {
			const curve = linkCurve(kind, { x: 0, y: 0 }, { x: 100, y: 40 });
			expect(curve).toEqual({ type: 'cubic', from: { x: 0, y: 0 }, c1: { x: 50, y: 0 }, c2: { x: 50, y: 40 }, to: { x: 100, y: 40 } });
		}
	});

	it('arcs blocker and discovered-from links, the control a fifth of the length off the middle', () => {
		for (const kind of ['blocker', 'discovered'] as const) {
			const curve = linkCurve(kind, { x: 0, y: 0 }, { x: 100, y: 0 });
			expect(curve).toEqual({ type: 'quadratic', from: { x: 0, y: 0 }, c: { x: 50, y: 20 }, to: { x: 100, y: 0 } });
		}
	});
});

describe('which links draw at rest', () => {
	it('draws chain links and agent lines, and holds the others for focus or All links', () => {
		expect(linkAtRest('chain', false)).toBe(true);
		expect(linkAtRest('agent', false)).toBe(true);
		expect(linkAtRest('blocker', false)).toBe(false);
		expect(linkAtRest('discovered', false)).toBe(false);
		expect(linkAtRest('blocker', true)).toBe(true);
		expect(linkAtRest('discovered', true)).toBe(true);
	});
});
