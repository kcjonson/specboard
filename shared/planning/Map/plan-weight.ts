/**
 * Weight follows the plan (spec, Status encoding): ready and blocked items draw
 * smaller and lighter the further down the plan order they sit. Weight runs from 1 at
 * the top of the plan to 0 at the bottom, and everything else (in flight,
 * done) stays at 1. The tint goes toward the surface and stops where the mark still
 * clears 3:1, so most of the falloff is size and ring weight.
 */

/** Under 1, the falloff is quick near the top of the plan and flattens out further down. */
const FALLOFF_CURVE = 0.7;

/** A dot at the bottom of the plan keeps this share of its radius. */
const MIN_SIZE = 0.78;

/** A ring at the bottom of the plan keeps this share of its stroke. */
const MIN_RING = 0.6;

/** The tint a weight asks for before the contrast floor clamps it: 35% of the color at the bottom of the plan. */
const MIN_TINT = 0.35;

/** Each planned item's weight, by key. Items not in the plan carry full weight and aren't listed. */
export function planWeights(planOrder: readonly string[]): Map<string, number> {
	const weights = new Map<string, number>();
	const last = planOrder.length - 1;
	planOrder.forEach((key, index) => {
		const depth = last > 0 ? index / last : 0;
		weights.set(key, 1 - depth ** FALLOFF_CURVE);
	});
	return weights;
}

export const weightedRadius = (radius: number, weight: number): number => radius * (MIN_SIZE + (1 - MIN_SIZE) * weight);

export const ringScale = (weight: number): number => MIN_RING + (1 - MIN_RING) * weight;

/** How much of the status color a mark keeps: what its weight asks for, never under the contrast floor. */
export const tintAmount = (weight: number, floor: number): number => Math.max(floor, MIN_TINT + (1 - MIN_TINT) * weight);
