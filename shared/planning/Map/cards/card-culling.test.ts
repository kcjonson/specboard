import { describe, expect, it } from 'vitest';
import { intersects } from '../box-index';
import { drawDot } from '../draw-dot.fixture';
import type { DrawDot } from '../draw-list';
import { CARD_ANCHOR, CARD_HEIGHT, CARD_WIDTH, CULL_MARGIN, MAX_CARDS, cardBox, visibleCards } from './card-culling';

const viewport = { width: 1000, height: 600 };

describe('card culling', () => {
	const at = (key: string, x: number, y: number): DrawDot => drawDot(key, x, y);

	it('keeps a card centered on its dot\'s glyph: the glyph sits on the dot', () => {
		const box = cardBox(at('A', 100, 50), { k: 3, x: 10, y: 20 });
		expect(box.x + CARD_ANCHOR.x).toBeCloseTo(10 + 3 * 100);
		expect(box.y + CARD_ANCHOR.y).toBeCloseTo(20 + 3 * 50);
		expect(box.w).toBe(CARD_WIDTH);
		expect(box.h).toBe(CARD_HEIGHT);
	});

	it('mounts the cards in view and not the ones far outside it', () => {
		const dots = [at('in', 100, 100), at('right', 5000, 100), at('left', -5000, 100), at('below', 100, 5000), at('above', 100, -5000)];
		expect(visibleCards(dots, { k: 1, x: 0, y: 0 }, viewport).map((d) => d.key)).toEqual(['in']);
	});

	it('includes a card that is only partly in view, since its body reaches in from its glyph', () => {
		// The glyph is left of the plot, but the card extends right into it.
		const dots = [at('partly', -CARD_ANCHOR.x - 10, 100), at('gone', -CARD_WIDTH - CULL_MARGIN - 40, 100)];
		expect(visibleCards(dots, { k: 1, x: 0, y: 0 }, viewport).map((d) => d.key)).toEqual(['partly']);
	});

	it('keeps a margin past the edge, so a pan never shows a card arriving', () => {
		const justPast = at('edge', viewport.width + CULL_MARGIN - 20, 100);
		expect(visibleCards([justPast], { k: 1, x: 0, y: 0 }, viewport)).toHaveLength(1);
		const beyond = at('beyond', viewport.width + CULL_MARGIN + CARD_ANCHOR.x + 5, 100);
		expect(visibleCards([beyond], { k: 1, x: 0, y: 0 }, viewport)).toHaveLength(0);
	});

	it('follows the camera: the same dots, panned, are a different set', () => {
		const dots = [at('a', 100, 100), at('b', 2000, 100)];
		expect(visibleCards(dots, { k: 1, x: 0, y: 0 }, viewport).map((d) => d.key)).toEqual(['a']);
		expect(visibleCards(dots, { k: 1, x: -1500, y: 0 }, viewport).map((d) => d.key)).toEqual(['b']);
		expect(visibleCards(dots, { k: 0.2, x: 0, y: 0 }, viewport).map((d) => d.key)).toEqual(['a', 'b']);
	});

	it('draws left to right, so a card\'s glyph and key stay readable under the next one', () => {
		const dots = [at('c', 300, 100), at('a', 100, 100), at('b', 200, 100)];
		expect(visibleCards(dots, { k: 1, x: 0, y: 0 }, viewport).map((d) => d.key)).toEqual(['a', 'b', 'c']);
	});

	it('mounts no more than the cap, keeping the ones nearest the middle', () => {
		const dots = Array.from({ length: MAX_CARDS + 100 }, (_, i) => at(`D${String(i).padStart(4, '0')}`, (i % 40) * 20, Math.floor(i / 40) * 20));
		const shown = visibleCards(dots, { k: 1, x: 0, y: 0 }, viewport);
		expect(shown).toHaveLength(MAX_CARDS);
		const middle = { x: viewport.width / 2, y: viewport.height / 2 };
		const dropped = dots.filter((d) => !shown.includes(d) && intersects(cardBox(d, { k: 1, x: 0, y: 0 }), { x: 0, y: 0, w: viewport.width, h: viewport.height }));
		const farthestShown = Math.max(...shown.map((d) => Math.hypot(d.x - middle.x, d.y - middle.y)));
		for (const d of dropped) expect(Math.hypot(d.x - middle.x, d.y - middle.y)).toBeGreaterThanOrEqual(farthestShown - 1e-9);
	});

	it('walks 2,000 dots fast enough to do on every frame of a pan', () => {
		const dots = Array.from({ length: 2000 }, (_, i) => at(`P${i}`, (i % 80) * 30, Math.floor(i / 80) * 30));
		const started = Date.now();
		for (let i = 0; i < 50; i++) visibleCards(dots, { k: 4, x: -i * 10, y: -200 }, viewport);
		expect((Date.now() - started) / 50).toBeLessThan(5);
	});
});
