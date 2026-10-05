import { describe, expect, it } from 'vitest';
import type { Box } from './box-index';
import type { Transform } from './camera';
import { controlAt, expandControls, labelControls } from './collapse-controls';
import { drawDot } from './draw-dot.fixture';
import type { DrawDot, DrawRegion } from './draw-list';
import { placeLabels } from './label-placement';
import { BAR_WIDTH, LABEL_HEIGHT, fitText, glideLabels, labelCenters, rollupSegments, shiftLabel, type Circle, type RegionLabel } from './region-labels';
import { traceRegions, type RegionOutline } from './regions/outline';

const measure = (text: string): number => text.length * 7;
const viewport = { width: 1000, height: 600 };
const identity: Transform = { k: 1, x: 0, y: 0 };

const region = (key: string, size: number, title = `Region ${key}`): DrawRegion => ({
	key,
	title,
	status: 'in_progress',
	weight: 1,
	cue: null,
	pr: false,
	reason: null,
	upNext: null,
	rollup: { done: 2, in_flight: 1, next: 1, later: 0 },
	size,
});

const dot = drawDot;

const outlineFor = (key: string, members: Array<[number, number]>): RegionOutline =>
	traceRegions([{ key, parentKey: null, height: 1, members: members.map(([x, y]) => ({ x, y, r: 5.5 })) }], 5)[0]!;

interface RegionLabelCase {
	regions: DrawRegion[];
	outlines: Map<string, RegionOutline>;
	dots: DrawDot[];
	transform: Transform;
	viewport: { width: number; height: number };
	measure: (text: string) => number;
	cap: number | null;
	occupied: Circle[];
}

const regionLabels = ({ regions, outlines, dots, transform, viewport, measure, cap, occupied }: RegionLabelCase): RegionLabel[] =>
	placeLabels({
		rules: { dots: 'none', regions: cap, cards: false },
		level: 'middle',
		regions,
		outlines,
		dots,
		transform,
		viewport,
		measure,
		agents: [],
		blocks: [],
		occupied: { circles: occupied, boxes: [] },
	}).regions;

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('region labels', () => {
	const a = outlineFor('A', [[300, 300], [340, 310], [380, 300]]);

	it('sits on the outline at its top, centered, with glyph, title, rollup bar, and control in a row', () => {
		const [label] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [], transform: identity, viewport, measure, cap: null, occupied: [] });
		// On the curve at its top: at or a hair above the highest point the curve passes through at a segment end.
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeLessThanOrEqual(a.top.y);
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeGreaterThan(a.top.y - 2);
		expect(label!.box.x + label!.box.w / 2).toBeCloseTo(a.top.x);
		expect(label!.glyph.x).toBeLessThan(label!.titleAt.x);
		expect(label!.titleAt.x + measure(label!.title)).toBeLessThan(label!.bar.x);
		expect(label!.bar.w).toBe(BAR_WIDTH);
		expect(label!.bar.x + label!.bar.w).toBeLessThan(label!.toggle.x - label!.toggle.r);
		expect(label!.toggle.x + label!.toggle.r).toBeLessThanOrEqual(label!.box.x + label!.box.w);
	});

	it('moves off a dot sitting where the label would go, and drops the label when there is no room at all', () => {
		const blocking = dot('X', a.top.x, a.top.y);
		const [moved] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [blocking], transform: identity, viewport, measure, cap: null, occupied: [] });
		expect(moved).toBeDefined();
		expect(overlap(moved!.box, { x: a.top.x - 6, y: a.top.y - 6, w: 12, h: 12 })).toBe(false);

		const crowd = Array.from({ length: 200 }, (_, i) => dot(`C${i}`, (i % 40) * 25, Math.floor(i / 40) * 120 + 60, { r: 60 }));
		expect(regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: crowd, transform: identity, viewport, measure, cap: null, occupied: [] })).toEqual([]);
	});

	it('slides along the bottom edge when the top and the middle of the bottom are taken', () => {
		const wide = outlineFor('W', [[200, 300], [260, 300], [320, 300], [380, 300], [440, 300]]);
		// A wall of dots over the whole top edge, and one under the middle of the bottom.
		const wall = Array.from({ length: 30 }, (_, i) => dot(`T${i}`, 140 + i * 12, wide.top.y));
		const under = dot('U', wide.bottom.x, wide.bottom.y, { r: 20 });
		const [label] = regionLabels({ regions: [region('W', 5, 'W')], outlines: new Map([['W', wide]]), dots: [...wall, under], transform: identity, viewport, measure, cap: null, occupied: [] });
		expect(label).toBeDefined();
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeGreaterThan(wide.top.y + 20);
		expect(overlap(label!.box, { x: under.x - 22, y: under.y - 22, w: 44, h: 44 })).toBe(false);
	});

	/** Whether a point on the outline, at any scale, sits within a pixel of (x, y). */
	const onOutline = (outline: RegionOutline, transform: Transform, x: number, y: number, tolerance = 1): boolean => {
		const { curve } = outline;
		for (let i = 2; i < curve.length; i += 4) {
			for (let s = 0; s <= 40; s++) {
				const t = s / 40;
				const u = 1 - t;
				const px = u * u * curve[i - 2]! + 2 * u * t * curve[i]! + t * t * curve[i + 2]!;
				const py = u * u * curve[i - 1]! + 2 * u * t * curve[i + 1]! + t * t * curve[i + 3]!;
				if (Math.hypot(transform.x + transform.k * px - x, transform.y + transform.k * py - y) <= tolerance) return true;
			}
		}
		return false;
	};

	it('sits on the outline wherever it goes: its middle line meets the curve inside the pill, at any scale', () => {
		const wall = Array.from({ length: 12 }, (_, i) => dot(`T${i}`, 270 + i * 12, a.top.y));
		for (const transform of [identity, { k: 2.5, x: -300, y: -250 }, { k: 5, x: -1000, y: -1000 }]) {
			// A wall of dots over the top forces the label to another spot on the edge.
			const blocked = wall.map((d) => ({ ...d }));
			const [label] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: transform === identity ? blocked : [], transform, viewport, measure, cap: null, occupied: [] });
			expect(label, `k ${transform.k}`).toBeDefined();
			const y = label!.box.y + label!.box.h / 2;
			// Some point of the curve is on the label's middle line, between the pill's ends.
			let met = false;
			for (let x = label!.box.x; x <= label!.box.x + label!.box.w && !met; x += 0.5) met = onOutline(a, transform, x, y, 1.5);
			expect(met, `k ${transform.k}`).toBe(true);
		}
	});

	it('finds room along the sides when the top and bottom are taken', () => {
		const tall = outlineFor('Tall', [[300, 100], [300, 160], [300, 220], [300, 280], [300, 340]]);
		// Dots all along the top and the bottom edge, so only the long sides are left.
		const top = Array.from({ length: 24 }, (_, i) => dot(`T${i}`, 190 + i * 10, tall.top.y));
		const bottom = Array.from({ length: 24 }, (_, i) => dot(`B${i}`, 190 + i * 10, tall.bottom.y));
		const [label] = regionLabels({ regions: [region('Tall', 5, 'Tall')], outlines: new Map([['Tall', tall]]), dots: [...top, ...bottom], transform: identity, viewport, measure, cap: null, occupied: [] });
		expect(label).toBeDefined();
		const middle = label!.box.y + label!.box.h / 2;
		expect(middle).toBeGreaterThan(tall.top.y + 30);
		expect(middle).toBeLessThan(tall.bottom.y - 30);
	});

	it('keeps off an expand control and off a dot\'s ink ring', () => {
		const ringed = dot('N', a.top.x, a.top.y - 14, { reason: 'question' });
		const control = { x: a.top.x + 60, y: a.top.y, r: 6 };
		const [label] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [ringed], transform: identity, viewport, measure, cap: null, occupied: [control] });
		expect(label).toBeDefined();
		expect(overlap(label!.box, { x: control.x - 6, y: control.y - 6, w: 12, h: 12 })).toBe(false);
		expect(overlap(label!.box, { x: ringed.x - 9, y: ringed.y - 9, w: 18, h: 18 })).toBe(false);
	});

	it('labels the largest regions first, never overlapping, up to the cap', () => {
		const outlines = new Map([
			['A', a],
			['B', outlineFor('B', [[600, 300], [640, 300]])],
			['C', outlineFor('C', [[320, 450]])],
		]);
		const regions = [region('C', 1), region('A', 3), region('B', 2)];
		const all = regionLabels({ regions, outlines, dots: [], transform: identity, viewport, measure, cap: null, occupied: [] });
		expect(all.map((label) => label.key)).toEqual(['A', 'B', 'C']);
		for (const x of all) for (const y of all) if (x !== y) expect(overlap(x.box, y.box)).toBe(false);
		expect(regionLabels({ regions, outlines, dots: [], transform: identity, viewport, measure, cap: 2, occupied: [] }).map((l) => l.key)).toEqual(['A', 'B']);
	});

	it('follows the camera: the label stays on the outline in screen space', () => {
		const transform = { k: 2, x: -100, y: -50 };
		const [label] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [], transform, viewport, measure, cap: null, occupied: [] });
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeLessThanOrEqual(-50 + 2 * a.top.y);
		expect(label!.box.y + LABEL_HEIGHT / 2).toBeGreaterThan(-50 + 2 * a.top.y - 4);
	});

	it('glides from where the label stood to the new outline over the crossfade, never jumping', () => {
		const [now] = regionLabels({ regions: [region('A', 3)], outlines: new Map([['A', a]]), dots: [], transform: identity, viewport, measure, cap: null, occupied: [] });
		const before = labelCenters([shiftLabel(now!, -80, 30)], identity);
		const at = (progress: number, transform: Transform = identity): RegionLabel => glideLabels([now!], before, transform, progress)[0]!;

		// At the start it stands where it was, with every part of it together; at the end it is on the new outline.
		expect(at(0).box.x).toBeCloseTo(now!.box.x - 80);
		expect(at(0).box.y).toBeCloseTo(now!.box.y + 30);
		expect(at(0).toggle.x - at(0).box.x).toBeCloseTo(now!.toggle.x - now!.box.x);
		expect(at(0.5).box.x).toBeCloseTo(now!.box.x - 40);
		expect(at(1)).toBe(now);

		// A camera that moved meanwhile carries the starting point with it.
		expect(at(0, { k: 1, x: 20, y: 0 }).box.x).toBeCloseTo(now!.box.x - 60);
		// A label with no past stands where it is.
		expect(glideLabels([now!], new Map(), identity, 0)[0]).toBe(now);
	});

	it('cuts a long title with an ellipsis', () => {
		expect(fitText('short', 100, measure)).toBe('short');
		const cut = fitText('a title much longer than the room it gets', 100, measure);
		expect(cut.endsWith('…')).toBe(true);
		expect(measure(cut)).toBeLessThanOrEqual(100);
		// An emoji at the cut goes whole or not at all, never half a surrogate pair.
		const loneHigh = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
		for (let room = 20; room < 120; room++) expect(fitText('Ship 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀 today', room, measure)).not.toMatch(loneHigh);
	});

	it('splits the rollup bar by phase, in phase order, every phase present at least visible', () => {
		const segments = rollupSegments({ done: 30, in_flight: 1, next: 0, later: 1 }, 10, 32);
		expect(segments.map((s) => s.phase)).toEqual(['done', 'in_flight', 'later']);
		expect(segments[0]!.x).toBe(10);
		expect(segments.at(-1)!.x + segments.at(-1)!.w).toBeCloseTo(42);
		for (const s of segments) expect(s.w).toBeGreaterThanOrEqual(2);
		expect(rollupSegments({ done: 0, in_flight: 0, next: 0, later: 0 }, 0, 32)).toEqual([]);
		// One live child in a hundred still shows, as a folded family's bar.
		const folded = rollupSegments({ done: 99, in_flight: 1, next: 0, later: 0 }, 0, 16);
		expect(folded.find((s) => s.phase === 'in_flight')!.w).toBeGreaterThanOrEqual(2);
	});
});

describe('collapse controls', () => {
	const a = outlineFor('A', [[300, 300], [340, 310]]);
	const labels = regionLabels({ regions: [region('A', 2)], outlines: new Map([['A', a]]), dots: [], transform: identity, viewport, measure, cap: null, occupied: [] });
	const folded = dot('F', 700, 300, { r: 12, status: 'done', folded: { count: 9, rollup: { done: 8, in_flight: 0, next: 0, later: 0 }, expandable: true } });
	const small = dot('S', 800, 300, { r: 3, status: 'done', folded: { count: 3, rollup: { done: 2, in_flight: 0, next: 0, later: 0 }, expandable: true } });
	// A family the read summarized past its cap: its children never came, so it can't open.
	const summarized = dot('R', 600, 200, { r: 12, status: 'done', folded: { count: 40, rollup: { done: 39, in_flight: 0, next: 0, later: 0 }, expandable: false } });

	it('puts a collapse control on each region label and an expand control on each folded dot that can open and is big enough for one', () => {
		const controls = [...labelControls(labels), ...expandControls([folded, small, summarized, dot('L', 100, 100)], identity, viewport, 'middle')];
		expect(controls.map((c) => [c.key, c.collapse])).toEqual([['A', true], ['F', false]]);
		const expand = controls[1]!.at;
		expect(expand.x).toBeGreaterThan(folded.x + 6);
		expect(expand.y).toBeLessThan(folded.y - 6);
	});

	it('hits a control within a little slop, and nothing elsewhere', () => {
		const controls = [...labelControls(labels), ...expandControls([folded], identity, viewport, 'middle')];
		const toggle = labels[0]!.toggle;
		expect(controlAt(controls, { x: toggle.x + toggle.r + 2, y: toggle.y })).toMatchObject({ key: 'A', collapse: true });
		expect(controlAt(controls, { x: 10, y: 10 })).toBeUndefined();
	});
});
