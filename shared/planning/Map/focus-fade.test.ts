import { describe, expect, it } from 'vitest';
import type { DrawLink } from './draw-list';
import { FADE_DARK, FADE_LIGHT, FOCUS_FADE_MS, FocusFade, darkness, dotStrength, growth, linkStrength, regionStrength, type FocusFrame } from './focus-fade';
import type { Relation } from './relations';

const relation = (key: string, over: Partial<Relation> = {}): Relation => ({
	key,
	region: false,
	dots: new Set([key]),
	regions: new Set(),
	outline: null,
	links: new Set(),
	...over,
});

function setup(reduced = false): { fade: FocusFade; clock: { now: number } } {
	const clock = { now: 0 };
	return { fade: new FocusFade(() => clock.now, () => reduced), clock };
}

describe('the focus fade', () => {
	it('runs 150 ms, ease-out, from nothing lit to one dot lit', () => {
		const { fade, clock } = setup();
		const a = relation('A', { dots: new Set(['A', 'B']) });
		fade.set(a);
		expect(fade.animating).toBe(true);
		expect(dotStrength(fade.frame(), 'C', FADE_LIGHT)).toBe(1);

		clock.now = FOCUS_FADE_MS / 2;
		const half = dotStrength(fade.frame(), 'C', FADE_LIGHT);
		// Ease-out is past halfway at half the time.
		expect(half).toBeLessThan(1 - (1 - FADE_LIGHT) / 2);
		expect(half).toBeGreaterThan(FADE_LIGHT);
		expect(dotStrength(fade.frame(), 'B', FADE_LIGHT)).toBe(1);

		clock.now = FOCUS_FADE_MS;
		expect(dotStrength(fade.frame(), 'C', FADE_LIGHT)).toBe(FADE_LIGHT);
		expect(fade.animating).toBe(false);
	});

	it('fades unrelated marks to 30% on a light surface and 40% on a dark one', () => {
		expect(FADE_LIGHT).toBe(0.3);
		expect(FADE_DARK).toBe(0.4);
	});

	it('is instant under reduced motion', () => {
		const { fade } = setup(true);
		fade.set(relation('A'));
		expect(fade.animating).toBe(false);
		expect(dotStrength(fade.frame(), 'Z', FADE_LIGHT)).toBe(FADE_LIGHT);
		fade.set(null);
		expect(dotStrength(fade.frame(), 'Z', FADE_LIGHT)).toBe(1);
	});

	it('crossfades from one focus straight to another instead of passing through full strength', () => {
		const { fade, clock } = setup();
		fade.set(relation('A'));
		clock.now = FOCUS_FADE_MS;
		fade.frame();
		fade.set(relation('B'));
		// At the start of the move A is still at full strength and B still faded.
		expect(dotStrength(fade.frame(), 'A', FADE_LIGHT)).toBe(1);
		expect(dotStrength(fade.frame(), 'B', FADE_LIGHT)).toBeCloseTo(FADE_LIGHT);
		clock.now += FOCUS_FADE_MS;
		expect(dotStrength(fade.frame(), 'A', FADE_LIGHT)).toBeCloseTo(FADE_LIGHT);
		expect(dotStrength(fade.frame(), 'B', FADE_LIGHT)).toBe(1);
	});

	it('does nothing when asked for the relation it is already on', () => {
		const { fade, clock } = setup();
		const a = relation('A');
		fade.set(a);
		clock.now = 40;
		fade.set(a);
		clock.now = FOCUS_FADE_MS;
		expect(fade.frame().t).toBe(1);
	});
});

describe('what each kind of mark does under focus', () => {
	const link = (over: Partial<DrawLink>): DrawLink => ({
		id: 'blocker:X>Y',
		kind: 'blocker',
		ends: ['X', 'Y'],
		from: { x: 0, y: 0 },
		to: { x: 1, y: 1 },
		satisfied: false,
		...over,
	});
	const lit = (to: Relation | null): FocusFrame => ({ from: null, to, t: 1 });

	it('draws a link focus lights, hides a blocker link it does not, and keeps a chain link while it is inside the set', () => {
		const to = relation('X', { dots: new Set(['X', 'Y', 'Q']), links: new Set(['blocker:X>Y']) });
		expect(linkStrength(lit(to), link({}), false, FADE_LIGHT)).toBe(1);
		expect(linkStrength(lit(to), link({ id: 'blocker:X>Z', ends: ['X', 'Z'] }), false, FADE_LIGHT)).toBe(0);
		expect(linkStrength(lit(to), link({ id: 'chain:X>Q', kind: 'chain', ends: ['X', 'Q'] }), false, FADE_LIGHT)).toBe(1);
		expect(linkStrength(lit(to), link({ id: 'chain:P>R', kind: 'chain', ends: ['P', 'R'] }), false, FADE_LIGHT)).toBe(FADE_LIGHT);
	});

	it('fades every unlit link with All links on, and draws them all at rest', () => {
		const to = relation('X', { links: new Set(['blocker:X>Y']) });
		const other = link({ id: 'blocker:P>R', ends: ['P', 'R'] });
		expect(linkStrength(lit(to), other, true, FADE_LIGHT)).toBe(FADE_LIGHT);
		expect(linkStrength(lit(null), other, true, FADE_LIGHT)).toBe(1);
		expect(linkStrength(lit(null), other, false, FADE_LIGHT)).toBe(0);
	});

	it('grows only the focused dot, and darkens only the focused region outline', () => {
		expect(growth(lit(relation('A')), 'A')).toBe(1);
		expect(growth(lit(relation('A')), 'B')).toBe(0);
		expect(growth(lit(relation('R', { region: true, outline: 'R' })), 'R')).toBe(0);
		expect(darkness(lit(relation('R', { region: true, outline: 'R' })), 'R')).toBe(1);
		expect(darkness(lit(relation('A', { outline: 'R' })), 'S')).toBe(0);
	});

	it('fades a region outside the set and not one inside it', () => {
		const to = relation('A', { regions: new Set(['R']) });
		expect(regionStrength(lit(to), 'R', FADE_DARK)).toBe(1);
		expect(regionStrength(lit(to), 'S', FADE_DARK)).toBe(FADE_DARK);
	});
});
