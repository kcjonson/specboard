import { describe, expect, it } from 'vitest';
import { intersects, type Box } from './box-index';
import type { Transform } from './camera';
import { CARD_GAP, cardBox } from './cards/card-culling';
import { screenRadius } from './dot-boxes';
import { drawDot } from './draw-dot.fixture';
import { MAX_DOT_LABEL, type LabelFont } from './dot-labels';
import type { DrawDot, DrawRegion } from './draw-list';
import { crossFade, crossFadeAll, placeLabels, type LabelInput } from './label-placement';
import type { Circle } from './region-labels';
import { traceRegions, type RegionOutline } from './regions/outline';
import { LABEL_RULES } from './zoom-levels';

const viewport = { width: 1000, height: 600 };
const identity: Transform = { k: 1, x: 0, y: 0 };
const measure = (text: string): number => text.length * 6;

const region = (key: string, size: number): DrawRegion => ({
	key,
	title: `Region ${key}`,
	status: 'in_progress',
	weight: 1,
	cue: null,
	pr: false,
	needsPerson: false,
	rollup: { done: 2, in_flight: 1, next: 1, later: 0 },
	size,
});

const outlineFor = (key: string, members: Array<[number, number]>): RegionOutline =>
	traceRegions([{ key, parentKey: null, height: 1, members: members.map(([x, y]) => ({ x, y, r: 5.5 })) }], 5)[0]!;

function input(over: Partial<LabelInput> & Pick<LabelInput, 'dots'>): LabelInput {
	return {
		rules: LABEL_RULES.middle,
		level: 'middle',
		regions: [],
		outlines: new Map(),
		transform: identity,
		viewport,
		measure,
		named: new Set(),
		occupied: { circles: [], boxes: [] },
		...over,
	};
}

/** A deterministic scatter of dots with a mix of statuses, dense enough that labels compete. */
function scatter(count: number, seed: number): DrawDot[] {
	let state = seed;
	const random = (): number => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	return Array.from({ length: count }, (_, i) => {
		const roll = random();
		return drawDot(`P-${i}`, 20 + random() * 960, 20 + random() * 560, {
			title: `A title of some length ${i}`,
			r: 4 + random() * 8,
			flight: roll < 0.12 ? 'in_progress' : roll < 0.25 ? 'in_review' : null,
			needsPerson: roll > 0.9,
		});
	});
}

const drawnExtent = (dot: DrawDot, { k, x, y }: Transform): Box => {
	const r = dot.r * k;
	return { x: x + dot.x * k - r, y: y + dot.y * k - r, w: 2 * r, h: 2 * r };
};

describe('label placement', () => {
	const pillA = outlineFor('A', [[300, 300], [340, 310], [380, 300]]);
	const pillB = outlineFor('B', [[700, 200], [740, 210]]);
	const regions = [region('A', 3), region('B', 2)];
	const outlines = new Map([['A', pillA], ['B', pillB]]);
	const minimap: Box = { x: 12, y: 470, w: 208, h: 118 };
	const control: Circle = { x: 500, y: 300, r: 6 };

	it('never puts a label over a dot, another label, a region pill, the minimap, or a control', () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			for (const rules of [LABEL_RULES.far, LABEL_RULES.middle]) {
				const dots = scatter(160, seed);
				const placed = placeLabels(input({ dots, rules, regions, outlines, occupied: { circles: [control], boxes: [minimap] } }));
				const boxes: Array<{ what: string; box: Box }> = [
					...placed.dots.map((label) => ({ what: `label ${label.key}`, box: label.box })),
					...placed.regions.map((label) => ({ what: `pill ${label.key}`, box: label.box })),
				];
				expect(boxes.length).toBeGreaterThan(5);
				for (const { what, box } of boxes) {
					for (const dot of dots) expect(intersects(box, drawnExtent(dot, identity)), `${what} over dot ${dot.key} (seed ${seed})`).toBe(false);
					expect(intersects(box, minimap), `${what} over the minimap`).toBe(false);
					expect(intersects(box, { x: control.x - control.r, y: control.y - control.r, w: 2 * control.r, h: 2 * control.r }), `${what} over a control`).toBe(false);
				}
				for (let i = 0; i < boxes.length; i++) {
					for (let j = i + 1; j < boxes.length; j++) {
						expect(intersects(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.what} over ${boxes[j]!.what} (seed ${seed})`).toBe(false);
					}
				}
			}
		}
	});

	it('holds under a camera that is zoomed and panned, where the same board has different room', () => {
		const dots = scatter(120, 9);
		const transform = { k: 2.4, x: -300, y: -120 };
		const placed = placeLabels(input({ dots, regions, outlines, transform, occupied: { circles: [], boxes: [minimap] } }));
		expect(placed.dots.length).toBeGreaterThan(0);
		const all = [...placed.dots.map((l) => l.box), ...placed.regions.map((l) => l.box)];
		for (const box of all) {
			expect(intersects(box, minimap)).toBe(false);
			for (const dot of dots) expect(intersects(box, drawnExtent(dot, transform))).toBe(false);
		}
	});

	it('gives in-progress dots the first pick, then in-review (after the regions), then every other dot, bigger first', () => {
		const dots = [
			drawDot('Z-ready', 100, 100, { r: 5 }),
			drawDot('B-big', 100, 200, { r: 12 }),
			drawDot('R-review', 100, 300, { flight: 'in_review' }),
			drawDot('P-progress', 100, 400, { flight: 'in_progress' }),
		];
		const placed = placeLabels(input({ dots }));
		expect(placed.dots.map((l) => l.key)).toEqual(['P-progress', 'R-review', 'B-big', 'Z-ready']);
		expect(placed.dots.map((l) => l.strong)).toEqual([true, true, false, false]);
	});

	it('labels only in-flight dots at the far level, with in-progress ahead of in-review', () => {
		const dots = [drawDot('X', 50, 50), drawDot('R', 150, 50, { flight: 'in_review' }), drawDot('P', 250, 50, { flight: 'in_progress' })];
		const placed = placeLabels(input({ dots, rules: LABEL_RULES.far }));
		expect(placed.dots.map((l) => l.key)).toEqual(['P', 'R']);
		// Near, dots that have room get a card, which says what a label would.
		const apart = [drawDot('X', 50, 50), drawDot('R', 350, 50), drawDot('P', 650, 50)];
		const near = placeLabels(input({ dots: apart, level: 'near', rules: LABEL_RULES.near }));
		expect(near.cards.map((dot) => dot.key).sort()).toEqual(['P', 'R', 'X']);
		expect(near.dots).toEqual([]);
	});

	it('leaves out an item another layer already names, at any level', () => {
		const dots = [drawDot('P1', 100, 100, { flight: 'in_progress' }), drawDot('P2', 100, 300, { flight: 'in_progress' }), drawDot('Q', 400, 300)];
		const named = new Set(['P1', 'Q']);
		for (const rules of [LABEL_RULES.far, LABEL_RULES.middle]) {
			expect(placeLabels(input({ dots, rules, named })).dots.map((l) => l.key)).toEqual(['P2']);
		}
	});

	it('writes the key and title, cut to the label width, in the font that matches its weight', () => {
		const fonts: LabelFont[] = [];
		const long = drawDot('SPE-12', 200, 200, { flight: 'in_progress', title: 'An extremely long title that goes on and on well past any width a label should have' });
		const placed = placeLabels(input({ dots: [long, drawDot('SPE-13', 600, 200, { title: 'Short' })], measure: (text, font) => (fonts.push(font), text.length * 6) }));
		const [strong, plain] = placed.dots;
		expect(strong!.text.startsWith('SPE-12 An extremely')).toBe(true);
		expect(strong!.text.endsWith('…')).toBe(true);
		expect(strong!.box.w).toBeLessThanOrEqual(MAX_DOT_LABEL + 4);
		expect(plain!.text).toBe('SPE-13 Short');
		expect(fonts).toContain('dot-strong');
		expect(fonts).toContain('dot');
	});

	it('caps region labels at the rules\' count, largest first', () => {
		const clusters = Array.from({ length: 12 }, (_, i) => outlineFor(`R${i}`, [[60 + (i % 6) * 165, 100 + Math.floor(i / 6) * 250], [100 + (i % 6) * 165, 110 + Math.floor(i / 6) * 250]]));
		const many = clusters.map((outline, i) => region(outline.key, 20 - i));
		const map = new Map(clusters.map((outline) => [outline.key, outline]));
		const far = placeLabels(input({ dots: [], regions: many, outlines: map, rules: LABEL_RULES.far }));
		expect(far.regions.map((l) => l.key)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']);
		const middle = placeLabels(input({ dots: [], regions: many, outlines: map, rules: LABEL_RULES.middle }));
		expect(middle.regions.length).toBe(12);
	});

	it('draws no label where there is no room', () => {
		const lone = drawDot('L', 500, 300, { flight: 'in_progress' });
		// A wall of reserved boxes around the dot, with nowhere a label could go.
		const walls: Box[] = [{ x: 0, y: 0, w: 1000, h: 600 }];
		expect(placeLabels(input({ dots: [lone], occupied: { circles: [], boxes: walls } })).dots).toEqual([]);
		expect(placeLabels(input({ dots: [lone] })).dots).toHaveLength(1);
	});

	it('finds a spot for a dot at the edge of the plot, and for one just past it whose label reaches in', () => {
		const edge = drawDot('E', 4, 300, { flight: 'in_progress' });
		const past = drawDot('F', -12, 100, { flight: 'in_progress', r: 5.5 });
		const placed = placeLabels(input({ dots: [edge, past] }));
		expect(placed.dots.map((l) => l.key).sort()).toEqual(['E', 'F']);
		const far = drawDot('G', -2000, 100, { flight: 'in_progress' });
		expect(placeLabels(input({ dots: [far] })).dots).toEqual([]);
	});

	it('is the same on every call: a pan that changes nothing changes no label', () => {
		const dots = scatter(100, 3);
		const once = placeLabels(input({ dots }));
		const again = placeLabels(input({ dots }));
		expect(again.dots.map((l) => [l.key, l.box.x, l.box.y])).toEqual(once.dots.map((l) => [l.key, l.box.x, l.box.y]));
	});
});

describe('card placement at the near level', () => {
	const toolbar: Box = { x: 4, y: 4, w: 200, h: 56 };
	const minimap: Box = { x: 12, y: 470, w: 208, h: 118 };
	const nearInput = (dots: DrawDot[], extra: Partial<LabelInput> = {}): LabelInput =>
		input({ dots, level: 'near', rules: LABEL_RULES.near, occupied: { circles: [], boxes: [toolbar, minimap] }, ...extra });
	const glyph = (dot: DrawDot): Box => {
		const r = screenRadius(dot, 4, 'near');
		return { x: dot.x - r, y: dot.y - r, w: 2 * r, h: 2 * r };
	};

	it('never puts a card over another card, the toolbar, the minimap, or another dot', () => {
		for (const seed of [1, 2, 3, 4, 5, 6]) {
			const dots = scatter(40, seed);
			const { cards } = placeLabels(nearInput(dots));
			expect(cards.length, `seed ${seed}`).toBeGreaterThan(2);
			expect(cards.length).toBeLessThan(dots.length);
			const boxes = cards.map((dot) => cardBox(dot, identity));
			for (let i = 0; i < boxes.length; i++) {
				expect(intersects(boxes[i]!, toolbar), `${cards[i]!.key} over the toolbar`).toBe(false);
				expect(intersects(boxes[i]!, minimap), `${cards[i]!.key} over the minimap`).toBe(false);
				for (const other of dots) if (other !== cards[i]) expect(intersects(boxes[i]!, glyph(other)), `${cards[i]!.key} over ${other.key}`).toBe(false);
				for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i]!, boxes[j]!), `${cards[i]!.key} over ${cards[j]!.key}`).toBe(false);
			}
		}
	});

	it('keeps a gap between cards, not just a hair', () => {
		const { cards } = placeLabels(nearInput(scatter(40, 2)));
		const boxes = cards.map((dot) => cardBox(dot, identity));
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const grown = { x: boxes[i]!.x - CARD_GAP + 1, y: boxes[i]!.y - CARD_GAP + 1, w: boxes[i]!.w + 2 * CARD_GAP - 2, h: boxes[i]!.h + 2 * CARD_GAP - 2 };
				expect(intersects(grown, boxes[j]!)).toBe(false);
			}
		}
	});

	it('gives a lone dot its card, and a card carries what a label would, so the dot has no label', () => {
		const lone = drawDot('A', 500, 250, { flight: 'in_progress' });
		const placed = placeLabels(nearInput([lone]));
		expect(placed.cards).toEqual([lone]);
		expect(placed.dots).toEqual([]);
	});

	it('falls back to a one-line label for dots too close for cards, and to the bare glyph where that does not fit either', () => {
		// A row of glyphs 26 px apart: a 148 px card would cover its neighbors.
		const row = Array.from({ length: 12 }, (_, i) => drawDot(`R-${i}`, 300 + i * 26, 250));
		const placed = placeLabels(nearInput(row));
		expect(placed.cards).toEqual([]);
		expect(placed.dots.length).toBeGreaterThan(0);
		expect(placed.dots.length).toBeLessThan(row.length);
	});

	it('gives a card up where it would sit under the toolbar or the minimap', () => {
		const underToolbar = drawDot('T', 40, 20);
		const beside = drawDot('B', 700, 250);
		const underMinimap = drawDot('M', 60, 500);
		const placed = placeLabels(nearInput([underToolbar, beside, underMinimap]));
		expect(placed.cards.map((dot) => dot.key)).toEqual(['B']);
	});

	it('lets a card reach past the plot\'s own edge', () => {
		const atEdge = drawDot('E', 960, 250);
		expect(placeLabels(nearInput([atEdge])).cards).toEqual([atEdge]);
	});

	it('gives in-progress dots the room first when two cards want the same ground', () => {
		const ready = drawDot('A-ready', 500, 250);
		const live = drawDot('Z-live', 560, 250, { flight: 'in_progress' });
		expect(placeLabels(nearInput([ready, live])).cards).toEqual([live]);
	});

	it('does not place cards at the other levels', () => {
		expect(placeLabels(input({ dots: scatter(40, 1), level: 'middle', rules: LABEL_RULES.middle })).cards).toEqual([]);
	});

	it('lets a dot\'s own card sit over its own expand control, and keeps every other card off it', () => {
		const folded = drawDot('F', 500, 250, { folded: { count: 9, rollup: { done: 8, in_flight: 0, next: 0, later: 0 }, expandable: true } });
		const owned = { x: 512, y: 238, r: 6, owner: 'F' };
		expect(placeLabels(nearInput([folded], { occupied: { circles: [owned], boxes: [] } })).cards).toEqual([folded]);
		// The same control belonging to nobody here is just something in the way.
		expect(placeLabels(nearInput([folded], { occupied: { circles: [{ ...owned, owner: 'elsewhere' }], boxes: [] } })).cards).toEqual([]);
	});
});

describe('crossFadeAll', () => {
	const dotLabel = (key: string, x: number): { key: string; text: string; box: Box; strong: boolean; alpha: number } => ({ key, text: key, box: { x, y: 0, w: 40, h: 14 }, strong: false, alpha: 1 });

	it('drops a label that is leaving where one is arriving, so the two never draw over each other, and fades the rest', () => {
		const next = { regions: [], dots: [dotLabel('new', 100)], cards: [] };
		const previous = { regions: [], dots: [dotLabel('overlapped', 110), dotLabel('clear', 300)], cards: [] };
		const faded = crossFadeAll(next, previous, 0.4);
		expect(faded.dots.map((label) => [label.key, label.alpha])).toEqual([['new', 0.4], ['clear', 0.6]]);
	});

	it('keeps a label both levels draw even where it moved over its own old spot', () => {
		const faded = crossFadeAll({ regions: [], dots: [dotLabel('same', 100)], cards: [] }, { regions: [], dots: [dotLabel('same', 105)], cards: [] }, 0.5);
		expect(faded.dots.map((label) => [label.key, label.alpha])).toEqual([['same', 1]]);
	});
});

describe('crossFade', () => {
	const label = (key: string, alpha = 1): { key: string; alpha: number } => ({ key, alpha });

	it('holds labels both levels draw at full strength, fades the new ones in, and the old ones out', () => {
		const faded = crossFade([label('kept'), label('arriving')], [label('kept'), label('leaving')], 0.25);
		expect(faded).toEqual([label('kept'), label('arriving', 0.25), label('leaving', 0.75)]);
	});

	it('is the new level alone at the end and the old one alone at the start', () => {
		const next = [label('a'), label('b')];
		const previous = [label('c')];
		expect(crossFade(next, previous, 1)).toEqual([label('a', 1), label('b', 1), label('c', 0)]);
		expect(crossFade(next, previous, 0)).toEqual([label('a', 0), label('b', 0), label('c', 1)]);
	});
});
