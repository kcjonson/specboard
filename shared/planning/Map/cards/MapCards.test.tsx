/**
 * The near level's cards: what mounts, where, and what a pan costs.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { drawDot } from '../draw-dot.fixture';
import { BoardBuilder } from '../layout/board-fixture';
import { EMPTY_OVERLAY, OverlayStore, type CardSet, type OverlayFrame } from '../overlay';
import { CARD_ANCHOR } from './card-culling';
import { MapCards } from './MapCards';

afterEach(cleanup);

function scene(): { rows: OverlayFrame['rows']; set: (k: number, keys?: string[]) => CardSet; keys: string[] } {
	const b = new BoardBuilder();
	const rows = new Map<string, ReturnType<BoardBuilder['add']>>();
	for (let i = 0; i < 4; i++) {
		const row = b.add({ status: i === 0 ? 'in_progress' : 'ready', title: `Card title ${i}`, subStatus: i === 0 ? 'scoping' : null, specCount: i === 0 ? 2 : i === 1 ? 1 : 0, prUrl: i === 0 || i === 2 ? 'https://github.com/a/b/pull/7' : null, originActorType: i === 3 ? 'user' : 'agent' });
		rows.set(row.key, row);
	}
	const keys = [...rows.keys()];
	const dots = keys.map((key, i) => drawDot(key, i * 40, 10 * i, { status: i === 0 ? 'in_progress' : 'ready', reason: i === 0 ? 'question' : null }));
	return {
		rows,
		keys,
		set: (k, only) => {
			const chosen = dots.filter((dot) => !only || only.includes(dot.key));
			return { dots: chosen, keys: new Set(chosen.map((dot) => dot.key)), k };
		},
	};
}

const frame = (over: Partial<OverlayFrame>): OverlayFrame => ({ ...EMPTY_OVERLAY, ...over });

describe('MapCards', () => {
	it('mounts nothing until there are cards, and says what each card holds when there are', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		expect(container.querySelectorAll('li')).toHaveLength(0);

		const { rows, set, keys } = scene();
		act(() => store.publish(frame({ rows, cards: set(4), cardAlpha: 1 })));
		const cards = container.querySelectorAll('li');
		expect(cards).toHaveLength(4);
		const first = cards[0]!.textContent!;
		expect(first).toContain(keys[0]);
		expect(first).toContain('Card title 0');
		expect(first).toContain('In Progress');
		// Too many marks for one row: the rest are said in text for assistive tech, behind a +N.
		expect(first).toContain('+3');
		expect(first).toContain('Also: Scoping, 2 specs, PR #7');
		expect(cards[1]!.textContent).toContain('Ready');
		expect(cards[1]!.textContent).toContain('Spec');
		expect(cards[2]!.textContent).toContain('PR #7');
		expect(cards[0]!.querySelector('svg[aria-label="In Progress"]')).not.toBeNull();
		expect(cards[3]!.querySelector('svg[aria-label="Made by a person"]')).not.toBeNull();
		expect(cards[0]!.querySelector('svg[aria-label="Made by an agent"]')).not.toBeNull();
	});

	it('places each card so its glyph sits on its dot at the scale it was given', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set } = scene();
		act(() => store.publish(frame({ rows, cards: set(4), cardAlpha: 1 })));
		const second = container.querySelectorAll('li')[1] as HTMLElement;
		expect(second.style.transform).toBe(`translate(${4 * 40 - CARD_ANCHOR.x}px, ${4 * 10 - CARD_ANCHOR.y}px)`);
	});

	it('moves the whole layer for a pan and leaves every card alone', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set } = scene();
		const cards = set(4);
		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, transform: { k: 4, x: 0, y: 0 } })));
		const layer = container.querySelector('ul') as HTMLElement;
		const before = Array.from(container.querySelectorAll('li'));
		const placed = before.map((li) => (li as HTMLElement).style.transform);

		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, transform: { k: 4, x: -37.4, y: 12.6 } })));
		expect(layer.style.transform).toBe('translate(-37px, 13px)');
		const after = Array.from(container.querySelectorAll('li'));
		expect(after).toEqual(before);
		expect(after.map((li) => (li as HTMLElement).style.transform)).toEqual(placed);
	});

	it('mounts only the cards that come into view and drops the ones that leave, keeping the rest', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set, keys } = scene();
		act(() => store.publish(frame({ rows, cards: set(4, [keys[0]!, keys[1]!]), cardAlpha: 1 })));
		const kept = container.querySelectorAll('li')[1];
		act(() => store.publish(frame({ rows, cards: set(4, [keys[1]!, keys[2]!]), cardAlpha: 1 })));
		const now = Array.from(container.querySelectorAll('li'));
		expect(now).toHaveLength(2);
		expect(now).toContain(kept);
		expect(now.some((li) => li.textContent!.includes(keys[2]!))).toBe(true);
		expect(container.textContent).not.toContain('Card title 0');
	});

	it('re-places the cards when the scale changes', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set } = scene();
		act(() => store.publish(frame({ rows, cards: set(4), cardAlpha: 1 })));
		act(() => store.publish(frame({ rows, cards: set(6), cardAlpha: 1 })));
		expect((container.querySelectorAll('li')[1] as HTMLElement).style.transform).toBe(`translate(${6 * 40 - CARD_ANCHOR.x}px, ${6 * 10 - CARD_ANCHOR.y}px)`);
	});

	it('fades the layer with the frame\'s alpha and unmounts the cards when the level has none', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set } = scene();
		act(() => store.publish(frame({ rows, cards: set(4), cardAlpha: 0.4 })));
		expect((container.querySelector('ul') as HTMLElement).style.opacity).toBe('0.4');
		act(() => store.publish(frame({ rows, cards: null, cardAlpha: 0 })));
		expect(container.querySelectorAll('li')).toHaveLength(0);
	});

	it('draws no card for a dot with no row', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { set } = scene();
		act(() => store.publish(frame({ rows: new Map(), cards: set(4), cardAlpha: 1 })));
		expect(container.querySelectorAll('li')).toHaveLength(0);
	});

	it('fades the cards outside what focus lit and marks the one it is on', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set, keys } = scene();
		const cards = set(4);
		const focus = { key: keys[1]!, region: false, dots: new Set([keys[1]!, keys[2]!]), regions: new Set<string>(), outline: null, links: new Set<string>() };
		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, focus })));
		const items = Array.from(container.querySelectorAll('li'));
		const faded = items.map((li) => li.className.includes('faded'));
		expect(faded).toEqual([true, false, false, true]);
		expect(items[1]!.className).toContain('lit');
		expect(items[2]!.className).not.toContain('lit');

		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, focus: null })));
		expect(Array.from(container.querySelectorAll('li')).some((li) => li.className.includes('faded'))).toBe(false);
	});

	it('moves a dragged dot\'s card with it, apart from its place, and lets go when the drag ends', () => {
		const store = new OverlayStore();
		const { container } = render(<MapCards store={store} bottom={32} />);
		const { rows, set, keys } = scene();
		const cards = set(4);
		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, transform: { k: 4, x: 0, y: 0 }, drag: { key: keys[1]!, dx: 10, dy: -5 } })));
		const second = container.querySelectorAll('li')[1] as HTMLElement;
		expect(second.style.translate).toBe('40px -20px');
		expect(second.style.transform).toContain('translate(');
		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, transform: { k: 4, x: 0, y: 0 }, drag: { key: keys[1]!, dx: 2, dy: 0 } })));
		expect(second.style.translate).toBe('8px 0px');
		act(() => store.publish(frame({ rows, cards, cardAlpha: 1, transform: { k: 4, x: 0, y: 0 }, drag: null })));
		expect(second.style.translate).toBe('');
	});
});
