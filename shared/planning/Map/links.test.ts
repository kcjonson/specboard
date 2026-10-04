import { describe, expect, it } from 'vitest';
import { NO_LIGHTING, linkCurve, linkShows } from './links';

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

describe('which links show', () => {
	it('draws chain links at rest and holds the others for focus or All links', () => {
		expect(linkShows('chain', 'chain:A>B', NO_LIGHTING)).toBe(true);
		expect(linkShows('blocker', 'blocker:A>B', NO_LIGHTING)).toBe(false);
		expect(linkShows('discovered', 'discovered:A>B', NO_LIGHTING)).toBe(false);
		expect(linkShows('blocker', 'blocker:A>B', { all: true, lit: null })).toBe(true);
		const lit = { all: false, lit: new Set(['blocker:A>B']) };
		expect(linkShows('blocker', 'blocker:A>B', lit)).toBe(true);
		expect(linkShows('discovered', 'discovered:A>C', lit)).toBe(false);
	});
});
