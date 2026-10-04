import type { CollapseChoices, CollapseStore } from './collapse-store';

/** A collapse store in memory, for tests: what was last written is what reads back. */
export function memoryCollapseStore(initial: CollapseChoices = {}): CollapseStore & { choices: CollapseChoices } {
	const store = {
		choices: initial,
		read: () => store.choices,
		write: (choices: CollapseChoices) => {
			store.choices = choices;
		},
	};
	return store;
}
