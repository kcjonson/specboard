import { describe, expect, it } from 'vitest';
import { LEAF_RADIUS } from './layout/constants';
import {
	FADE_MS,
	LABEL_RULES,
	MIDDLE_ENTER,
	MIDDLE_EXIT,
	NEAR_ENTER,
	NEAR_EXIT,
	ZoomLevels,
	leafRadius,
	levelAt,
	nextLevel,
	type ZoomLevel,
} from './zoom-levels';

/** The scale at which a leaf dot is `radius` px on screen. */
const scaleFor = (radius: number): number => radius / LEAF_RADIUS;

describe('zoom levels', () => {
	it('picks a level from a leaf dot\'s size on screen, not from the zoom factor', () => {
		expect(leafRadius(2)).toBe(2 * LEAF_RADIUS);
		expect(levelAt(scaleFor(MIDDLE_ENTER - 0.1))).toBe('far');
		expect(levelAt(scaleFor(MIDDLE_ENTER))).toBe('middle');
		expect(levelAt(scaleFor(NEAR_ENTER - 0.1))).toBe('middle');
		expect(levelAt(scaleFor(NEAR_ENTER))).toBe('near');
	});

	it('leaves a gap between entering and leaving each level', () => {
		expect(MIDDLE_EXIT).toBeLessThan(MIDDLE_ENTER);
		expect(NEAR_EXIT).toBeLessThan(NEAR_ENTER);
		expect(NEAR_EXIT).toBeGreaterThan(MIDDLE_ENTER);
	});

	it('stays in a level while the size is inside its gap, whichever side it came from', () => {
		const inMiddleGap = scaleFor((MIDDLE_ENTER + MIDDLE_EXIT) / 2);
		expect(nextLevel('far', inMiddleGap)).toBe('far');
		expect(nextLevel('middle', inMiddleGap)).toBe('middle');
		const inNearGap = scaleFor((NEAR_ENTER + NEAR_EXIT) / 2);
		expect(nextLevel('middle', inNearGap)).toBe('middle');
		expect(nextLevel('near', inNearGap)).toBe('near');
	});

	it('does not flip-flop when the camera hovers at a boundary', () => {
		for (const [enter, exit, from, to] of [
			[MIDDLE_ENTER, MIDDLE_EXIT, 'far', 'middle'],
			[NEAR_ENTER, NEAR_EXIT, 'middle', 'near'],
		] as const) {
			let level: ZoomLevel = from;
			let switches = 0;
			// A size wobbling by a pixel's quarter either side of the enter size, as a trackpad does.
			for (let i = 0; i < 200; i++) {
				const radius = enter + (i % 2 === 0 ? 0.25 : -0.25);
				const next = nextLevel(level, scaleFor(radius));
				if (next !== level) switches++;
				level = next;
			}
			expect(switches).toBe(1);
			expect(level).toBe(to);
			// And wobbling around the exit size from the other side switches once too.
			switches = 0;
			for (let i = 0; i < 200; i++) {
				const radius = exit + (i % 2 === 0 ? 0.25 : -0.25);
				const next = nextLevel(level, scaleFor(radius));
				if (next !== level) switches++;
				level = next;
			}
			expect(switches).toBe(1);
			expect(level).toBe(from);
		}
	});

	it('skips a level when a flight crosses both boundaries', () => {
		expect(nextLevel('far', scaleFor(NEAR_ENTER + 5))).toBe('near');
		expect(nextLevel('near', scaleFor(MIDDLE_EXIT - 1))).toBe('far');
	});

	it('draws labels per level as the spec says: in-flight dots and a few regions far out, everything with room in the middle, cards instead near', () => {
		expect(LABEL_RULES.far).toEqual({ dots: 'in-flight', regions: 8 });
		expect(LABEL_RULES.middle).toEqual({ dots: 'all', regions: null });
		expect(LABEL_RULES.near.dots).toBe('none');
	});
});

describe('ZoomLevels fades', () => {
	const setup = (): { levels: ZoomLevels; clock: { now: number; reduced: boolean } } => {
		const clock = { now: 1000, reduced: false };
		return { levels: new ZoomLevels(() => clock.now, () => clock.reduced), clock };
	};

	it('opens at the level the scale lands in, with no fade', () => {
		const { levels } = setup();
		levels.reset(scaleFor(MIDDLE_ENTER + 1));
		expect(levels.frame(scaleFor(MIDDLE_ENTER + 1))).toEqual({ level: 'middle', from: null, progress: 1 });
	});

	it('fades for the new level over the flight\'s length, then rests', () => {
		const { levels, clock } = setup();
		levels.reset(scaleFor(2));
		expect(levels.frame(scaleFor(2)).from).toBeNull();

		const started = levels.frame(scaleFor(MIDDLE_ENTER + 1));
		expect(started).toMatchObject({ level: 'middle', from: 'far', progress: 0 });

		clock.now += FADE_MS / 2;
		const halfway = levels.frame(scaleFor(MIDDLE_ENTER + 1));
		expect(halfway.from).toBe('far');
		// The flight's curve is front-loaded: past halfway in progress at half the time.
		expect(halfway.progress).toBeGreaterThan(0.5);
		expect(halfway.progress).toBeLessThan(1);

		clock.now += FADE_MS;
		expect(levels.frame(scaleFor(MIDDLE_ENTER + 1))).toEqual({ level: 'middle', from: null, progress: 1 });
	});

	it('cuts under reduced motion', () => {
		const { levels, clock } = setup();
		clock.reduced = true;
		levels.reset(scaleFor(2));
		expect(levels.frame(scaleFor(MIDDLE_ENTER + 1))).toEqual({ level: 'middle', from: null, progress: 1 });
	});

	it('does not start a fade for a move inside one level', () => {
		const { levels } = setup();
		levels.reset(scaleFor(10));
		for (const radius of [10, 12, 15, 20, 11]) expect(levels.frame(scaleFor(radius)).from).toBeNull();
	});
});
