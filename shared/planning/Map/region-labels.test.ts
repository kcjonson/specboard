import { describe, expect, it } from 'vitest';
import type { Transform } from './camera';
import { collapseControls, controlAt } from './collapse-controls';
import type { DrawDot, DrawRegion } from './draw-list';
import { BAR_WIDTH, LABEL_HEIGHT, fitText, placeRegionLabels, rollupSegments, type Box } from './region-labels';
import { traceRegions, type RegionOutline } from './regions/outline';

const measure = (text: string): number => text.length * 7;
const viewport = { width: 1000, height: 600 };
const identity: Transform = { k: 1, x: 0, y: 0 };

const region = (key: string, size: number, title = `Region ${key}`): DrawRegion => ({
	key,
	title,
	status: 'in_progress',
	needsPerson: false,
	rollup: { done: 2, in_flight: 1, next: 1, later: 0 },
	size,
});

const dot = (key: string, x: number, y: number, extra: Partial<DrawDot> = {}): DrawDot => ({
	key,
	x,
	y,
	r: 5.5,
	status: 'ready',
	weight: 1,
	needsPerson: false,
	cue: null,
	pr: false,
	folded: null,
	...extra,
});

const outlineFor = (key: string, members: Array<[number, number]>): RegionOutline =>
	traceRegions([{ key, parentKey: null, height: 1, members: members.map(([x, y]) => ({ x, y, r: 5.5 })) }], 5)[0]!;

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('region labels', () => {
	const a = outlineFor('A', [[300, 300], [340, 310], [380, 300]]);

	it('sits on the outline at its top, centered, with glyph, title, rollup bar, and control in a row', () => {
		const [label] = placeRegionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [], transform: identity, viewport, measure, cap: null });
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeCloseTo(a.top.y);
		expect(label!.box.x + label!.box.w / 2).toBeCloseTo(a.top.x);
		expect(label!.glyph.x).toBeLessThan(label!.titleAt.x);
		expect(label!.titleAt.x + measure(label!.title)).toBeLessThan(label!.bar.x);
		expect(label!.bar.w).toBe(BAR_WIDTH);
		expect(label!.bar.x + label!.bar.w).toBeLessThan(label!.toggle.x - label!.toggle.r);
		expect(label!.toggle.x + label!.toggle.r).toBeLessThanOrEqual(label!.box.x + label!.box.w);
	});

	it('moves off a dot sitting where the label would go, and drops the label when there is no room at all', () => {
		const blocking = dot('X', a.top.x, a.top.y);
		const [moved] = placeRegionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [blocking], transform: identity, viewport, measure, cap: null });
		expect(moved).toBeDefined();
		expect(overlap(moved!.box, { x: a.top.x - 6, y: a.top.y - 6, w: 12, h: 12 })).toBe(false);

		const crowd = Array.from({ length: 200 }, (_, i) => dot(`C${i}`, (i % 40) * 25, Math.floor(i / 40) * 120 + 60, { r: 60 }));
		expect(placeRegionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: crowd, transform: identity, viewport, measure, cap: null })).toEqual([]);
	});

	it('labels the largest regions first, never overlapping, up to the cap', () => {
		const outlines = new Map([
			['A', a],
			['B', outlineFor('B', [[600, 300], [640, 300]])],
			['C', outlineFor('C', [[320, 450]])],
		]);
		const regions = [region('C', 1), region('A', 3), region('B', 2)];
		const all = placeRegionLabels({ regions, outlines, dots: [], transform: identity, viewport, measure, cap: null });
		expect(all.map((label) => label.key)).toEqual(['A', 'B', 'C']);
		for (const x of all) for (const y of all) if (x !== y) expect(overlap(x.box, y.box)).toBe(false);
		expect(placeRegionLabels({ regions, outlines, dots: [], transform: identity, viewport, measure, cap: 2 }).map((l) => l.key)).toEqual(['A', 'B']);
	});

	it('follows the camera: the label stays on the outline in screen space', () => {
		const transform = { k: 2, x: -100, y: -50 };
		const [label] = placeRegionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [], transform, viewport, measure, cap: null });
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeCloseTo(-50 + 2 * a.top.y);
	});

	it('cuts a long title with an ellipsis', () => {
		expect(fitText('short', 100, measure)).toBe('short');
		const cut = fitText('a title much longer than the room it gets', 100, measure);
		expect(cut.endsWith('…')).toBe(true);
		expect(measure(cut)).toBeLessThanOrEqual(100);
	});

	it('splits the rollup bar by phase, in phase order, every phase present at least visible', () => {
		const segments = rollupSegments({ done: 30, in_flight: 1, next: 0, later: 1 }, 10, 32);
		expect(segments.map((s) => s.phase)).toEqual(['done', 'in_flight', 'later']);
		expect(segments[0]!.x).toBe(10);
		expect(segments.at(-1)!.x + segments.at(-1)!.w).toBeCloseTo(42);
		for (const s of segments) expect(s.w).toBeGreaterThanOrEqual(2);
		expect(rollupSegments({ done: 0, in_flight: 0, next: 0, later: 0 }, 0, 32)).toEqual([]);
	});
});

describe('collapse controls', () => {
	const a = outlineFor('A', [[300, 300], [340, 310]]);
	const labels = placeRegionLabels({ regions: [region('A', 2)], outlines: new Map([['A', a]]), dots: [], transform: identity, viewport, measure, cap: null });
	const folded = dot('F', 700, 300, { r: 12, status: 'done', folded: { count: 9, rollup: { done: 8, in_flight: 0, next: 0, later: 0 } } });
	const small = dot('S', 800, 300, { r: 3, status: 'done', folded: { count: 3, rollup: { done: 2, in_flight: 0, next: 0, later: 0 } } });

	it('puts a collapse control on each region label and an expand control on each folded dot big enough for one', () => {
		const controls = collapseControls(labels, [folded, small, dot('L', 100, 100)], identity, viewport);
		expect(controls.map((c) => [c.key, c.collapse])).toEqual([['A', true], ['F', false]]);
		const expand = controls[1]!.at;
		expect(expand.x).toBeGreaterThan(folded.x + 6);
		expect(expand.y).toBeLessThan(folded.y - 6);
	});

	it('hits a control within a little slop, and nothing elsewhere', () => {
		const controls = collapseControls(labels, [folded], identity, viewport);
		const toggle = labels[0]!.toggle;
		expect(controlAt(controls, { x: toggle.x + toggle.r + 2, y: toggle.y })).toMatchObject({ key: 'A', collapse: true });
		expect(controlAt(controls, { x: 10, y: 10 })).toBeUndefined();
	});
});
