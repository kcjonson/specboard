import { parseItemKey } from '@specboard/core/identifiers';

const numbered = new WeakMap<readonly string[], ReadonlyMap<string, number>>();

/**
 * Each up-next item's number, 1 to 3 in its own project's order (spec, Up next). A
 * combined Map lists every project's up next one project after another, and each
 * project's run starts again at 1. Computed once per layout.
 */
export function upNextNumbers(upNext: readonly string[]): ReadonlyMap<string, number> {
	const known = numbered.get(upNext);
	if (known) return known;
	const counts = new Map<string | undefined, number>();
	const numbers = new Map<string, number>();
	for (const key of upNext) {
		const project = parseItemKey(key)?.projectKey;
		const number = (counts.get(project) ?? 0) + 1;
		counts.set(project, number);
		numbers.set(key, number);
	}
	numbered.set(upNext, numbers);
	return numbers;
}
