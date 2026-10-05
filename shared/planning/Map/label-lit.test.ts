import { describe, expect, it } from 'vitest';
import { intersects } from './box-index';
import type { Transform } from './camera';
import { markExtra, dotBox, dotReach } from './dot-boxes';
import { drawDot } from './draw-dot.fixture';
import type { LabelFont } from './dot-labels';
import type { DrawRegion } from './draw-list';
import { placeLabels, type LabelInput } from './label-placement';
import { traceRegions, type RegionOutline } from './regions/outline';
import { LABEL_RULES } from './zoom-levels';

const viewport = { width: 1000, height: 600 };
const identity: Transform = { k: 1, x: 0, y: 0 };
const measure = (text: string, _font?: LabelFont): number => text.length * 6;

const region = (key: string, size: number): DrawRegion => ({
	key,
	title: `Region ${key}`,
	status: 'in_progress',
	weight: 1,
	cue: null,
	pr: false,
	reason: null,
	upNext: null,
	rollup: { done: 2, in_flight: 1, next: 1, later: 0 },
	size,
});

const outlineFor = (key: string, at: number): RegionOutline =>
	traceRegions([{ key, parentKey: null, height: 1, members: [[at, 300], [at + 40, 310]].map(([x, y]) => ({ x: x!, y: y!, r: 5.5 })) }], 5)[0]!;

function input(over: Partial<LabelInput> & Pick<LabelInput, 'dots'>): LabelInput {
	return {
		rules: LABEL_RULES.far,
		level: 'far',
		regions: [],
		outlines: new Map(),
		transform: identity,
		viewport,
		measure,
		agents: [],
		blocks: [],
		occupied: { circles: [], boxes: [] },
		...over,
	};
}

describe('labels for what a search or filter lit', () => {
	const dots = [drawDot('A', 100, 100), drawDot('B', 300, 100), drawDot('C', 500, 100), drawDot('P', 700, 100, { flight: 'in_progress' })];

	it('gives matches a label at the far level, where nothing but in-flight work has one', () => {
		expect(placeLabels(input({ dots })).dots.map((label) => label.key)).toEqual(['P']);
		const placed = placeLabels(input({ dots, lit: { dots: new Set(['B', 'C']), outlined: new Set() } }));
		expect(placed.dots.map((label) => label.key).sort()).toEqual(['B', 'C', 'P']);
	});

	it('writes a match in full ink, as it does in-flight work', () => {
		const placed = placeLabels(input({ dots, lit: { dots: new Set(['B']), outlined: new Set() } }));
		expect(placed.dots.find((label) => label.key === 'B')!.strong).toBe(true);
	});

	it('names a match before the regions take the room, but never over a dot or another label', () => {
		const dense = Array.from({ length: 80 }, (_, i) => drawDot(`D${i}`, 20 + (i % 10) * 90, 20 + Math.floor(i / 10) * 60));
		const placed = placeLabels(input({ dots: dense, lit: { dots: new Set(['D33', 'D34', 'D35']), outlined: new Set() } }));
		const boxes = placed.dots.map((label) => label.box);
		expect(placed.dots.length).toBeGreaterThan(0);
		for (const box of boxes) {
			for (const dot of dense) {
				const r = dot.r;
				expect(intersects(box, { x: dot.x - r, y: dot.y - r, w: 2 * r, h: 2 * r })).toBe(false);
			}
		}
		for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i]!, boxes[j]!)).toBe(false);
	});

	it('gives a region that matched its label past the far level\'s cap, and ahead of bigger ones', () => {
		const keys = Array.from({ length: 10 }, (_, i) => `R${i}`);
		const regions = keys.map((key, i) => region(key, 20 - i));
		const outlines = new Map(keys.map((key, i) => [key, outlineFor(key, 40 + i * 90)]));
		const plain = placeLabels(input({ dots: [], regions, outlines }));
		expect(plain.regions).toHaveLength(8);
		expect(plain.regions.map((label) => label.key)).not.toContain('R9');
		const lit = placeLabels(input({ dots: [], regions, outlines, lit: { dots: new Set(), outlined: new Set(['R9']) } }));
		expect(lit.regions.map((label) => label.key)).toContain('R9');
		expect(lit.regions[0]!.key).toBe('R9');
	});
});

describe('labels in the changes view', () => {
	const dots = [
		drawDot('A', 100, 100), drawDot('B', 300, 100), drawDot('C', 500, 100), drawDot('D', 700, 100),
		drawDot('R', 100, 300, { flight: 'in_review' }), drawDot('S', 300, 300, { flight: 'in_review' }), drawDot('P', 700, 300, { flight: 'in_progress' }),
	];
	const lit = { dots: new Set(['A', 'B', 'C', 'S']), outlined: new Set<string>(), recent: new Set(['B', 'C']) };

	it('names only the most recent changes at rest, ahead of everything else', () => {
		const placed = placeLabels(input({ dots, lit }));

		expect(placed.dots.map((label) => label.key).sort()).toEqual(['B', 'C', 'P', 'S']);
	});

	it('leaves in-review dots that did not change unnamed, since the Map dims them', () => {
		expect(placeLabels(input({ dots, lit })).dots.map((label) => label.key)).not.toContain('R');
	});

	it('gives the families no label at rest, but keeps one a changed parent earned', () => {
		const keys = ['R0', 'R1', 'R2'];
		const regions = keys.map((key, i) => region(key, 10 - i));
		const outlines = new Map(keys.map((key, i) => [key, outlineFor(key, 40 + i * 90)]));

		expect(placeLabels(input({ dots: [], regions, outlines })).regions).toHaveLength(3);
		expect(placeLabels(input({ dots: [], regions, outlines, lit: { dots: new Set(), outlined: new Set(), recent: new Set() } })).regions).toEqual([]);
		const kept = placeLabels(input({ dots: [], regions, outlines, lit: { dots: new Set(), outlined: new Set(['R1']), recent: new Set(['R1']) } }));
		expect(kept.regions.map((label) => label.key)).toEqual(['R1']);
	});

	it('names every changed dot with room once zoomed in, where every dot is named anyway', () => {
		const placed = placeLabels(input({ dots, lit, rules: LABEL_RULES.middle, level: 'middle' }));

		expect(placed.dots.map((label) => label.key)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'S']));
	});
});

describe('marks that reach past a dot\'s ring', () => {
	it('widens the box of an up-next dot at every level, and of one that needs a person once zoomed in', () => {
		const plain = drawDot('A', 100, 100);
		const upNext = drawDot('B', 100, 100, { upNext: 1 });
		const ringed = drawDot('C', 100, 100, { reason: 'question' });
		expect(markExtra(plain, 'middle')).toBe(0);
		expect(markExtra(upNext, 'far')).toBeGreaterThan(0);
		expect(markExtra(ringed, 'far')).toBe(0);
		expect(markExtra(ringed, 'middle')).toBeGreaterThan(0);
		expect(dotBox(upNext, identity, 'far').w).toBeGreaterThan(dotBox(plain, identity, 'far').w);
		expect(dotReach(ringed, 1, 'near')).toBeGreaterThan(dotReach(plain, 1, 'near'));
	});

	it('keeps a label clear of an up-next dot\'s number', () => {
		const dot = drawDot('A', 300, 300, { upNext: 2, flight: 'in_progress' });
		const [label] = placeLabels(input({ dots: [dot] })).dots;
		expect(label).toBeDefined();
		// The number sits at the upper right, 14 px across and just past the ring.
		expect(intersects(label!.box, { x: 300 + 6, y: 300 - 22, w: 16, h: 16 })).toBe(false);
	});
});

describe('a region label that carries an up-next number', () => {
	const outline = outlineFor('A', 200);
	const labelsOf = (regions: DrawRegion[]): ReturnType<typeof placeLabels>['regions'] =>
		placeLabels(input({ dots: [], regions, outlines: new Map([['A', outline]]), rules: { dots: 'none', regions: null, cards: false } })).regions;

	it('is wider by the number\'s room, with its badge between the glyph and the title', () => {
		const [plain] = labelsOf([region('A', 3)]);
		const [numbered] = labelsOf([{ ...region('A', 3), upNext: 2 }]);
		expect(plain!.badge).toBeNull();
		expect(numbered!.badge).not.toBeNull();
		expect(numbered!.box.w).toBeGreaterThan(plain!.box.w);
		expect(numbered!.badge!.x).toBeGreaterThan(numbered!.glyph.x);
		expect(numbered!.badge!.x + numbered!.badge!.r).toBeLessThanOrEqual(numbered!.titleAt.x);
	});

	it('keeps the reason a parent needs a person, which its glyph wears as the ink ring', () => {
		const [label] = labelsOf([{ ...region('A', 3), reason: 'review' }]);
		expect(label!.region.reason).toBe('review');
	});
});
