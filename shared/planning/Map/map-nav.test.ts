import { describe, expect, it } from 'vitest';
import { cycle, pickInDirection, type NavTarget } from './map-nav';

const at = (key: string, x: number, y: number): NavTarget => ({ key, x, y });
const origin = { x: 0, y: 0 };

describe('pickInDirection', () => {
	it('picks the nearest target on the arrow\'s axis', () => {
		const targets = [at('near', 10, 0), at('far', 40, 0), at('behind', -5, 0)];
		expect(pickInDirection(origin, targets, 'right')?.key).toBe('near');
		expect(pickInDirection(origin, targets, 'left')?.key).toBe('behind');
	});

	it('works on all four axes', () => {
		const targets = [at('r', 10, 0), at('l', -10, 0), at('u', 0, -10), at('d', 0, 10)];
		expect(pickInDirection(origin, targets, 'right')?.key).toBe('r');
		expect(pickInDirection(origin, targets, 'left')?.key).toBe('l');
		expect(pickInDirection(origin, targets, 'up')?.key).toBe('u');
		expect(pickInDirection(origin, targets, 'down')?.key).toBe('d');
	});

	it('weights the offset across the arrow, so a dot straight ahead beats a nearer one off to the side', () => {
		const straight = at('straight', 30, 0);
		const aside = at('aside', 20, 15);
		expect(pickInDirection(origin, [aside, straight], 'right')?.key).toBe('straight');
	});

	it('counts 45 degrees as the edge of the cone, and tries the cone before anything outside it', () => {
		const inside = at('inside', 20, 20);
		const outside = at('outside', 5, 21);
		expect(pickInDirection(origin, [outside, inside], 'right')?.key).toBe('inside');
		// The same two seen from the other axis: now `outside` is the one nearly straight ahead.
		expect(pickInDirection(origin, [outside, inside], 'down')?.key).toBe('outside');
	});

	it('falls back to the half-plane ahead when the cone is empty, so a sparse corner never traps focus', () => {
		const shallow = at('shallow', 5, 40);
		expect(pickInDirection(origin, [shallow], 'right')?.key).toBe('shallow');
		expect(pickInDirection(origin, [shallow], 'left')).toBeNull();
	});

	it('stops at the edge instead of wrapping: nothing past the last target in a direction', () => {
		const targets = [at('a', -30, 0), at('b', 30, 0)];
		expect(pickInDirection({ x: 30, y: 0 }, targets, 'right', 'b')).toBeNull();
		expect(pickInDirection({ x: -30, y: 0 }, targets, 'left', 'a')).toBeNull();
	});

	it('never lands on the target it starts from, or on one level with it', () => {
		const targets = [at('here', 0, 0), at('level', 0, 25)];
		expect(pickInDirection(origin, targets, 'right', 'here')).toBeNull();
		expect(pickInDirection(origin, targets, 'down', 'here')?.key).toBe('level');
	});

	it('breaks a tie by key, whatever order the targets come in', () => {
		const targets = [at('b', 10, -10), at('a', 10, 10)];
		expect(pickInDirection(origin, targets, 'right')?.key).toBe('a');
		expect(pickInDirection(origin, [...targets].reverse(), 'right')?.key).toBe('a');
	});

	it('is null with nothing to land on', () => {
		expect(pickInDirection(origin, [], 'up')).toBeNull();
	});
});

describe('cycle', () => {
	const list = ['a', 'b', 'c'];

	it('goes to the next and wraps at the end', () => {
		expect(cycle(list, 'a', 1)).toBe('b');
		expect(cycle(list, 'c', 1)).toBe('a');
	});

	it('goes to the previous and wraps at the start', () => {
		expect(cycle(list, 'b', -1)).toBe('a');
		expect(cycle(list, 'a', -1)).toBe('c');
	});

	it('starts at the first going forward and the last going back when it is not on the list', () => {
		expect(cycle(list, 'x', 1)).toBe('a');
		expect(cycle(list, null, 1)).toBe('a');
		expect(cycle(list, 'x', -1)).toBe('c');
		expect(cycle(list, null, -1)).toBe('c');
	});

	it('is null for an empty list', () => {
		expect(cycle([], null, 1)).toBeNull();
	});
});
