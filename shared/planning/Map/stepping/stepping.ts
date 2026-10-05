/**
 * Stepping through an ordered list of items, which search matches and the changes view
 * both do. `at` is the current index, or -1 before the first step; a step wraps around
 * the ends, so `]` on the last item goes to the first and `[` on the first to the last.
 */
export function nextStep(at: number, delta: 1 | -1, count: number): number {
	if (count === 0) return -1;
	if (at < 0) return delta === 1 ? 0 : count - 1;
	return (at + delta + count) % count;
}

/** `2 of 5` while stepping, and a plain count before the first step. */
export function stepText(at: number, count: number, unit: readonly [string, string]): string {
	return at < 0 ? `${count} ${count === 1 ? unit[0] : unit[1]}` : `${at + 1} of ${count}`;
}
