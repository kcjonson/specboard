import { mapCollapsePref, readPref, writePref } from '../Planning/prefs';

/** A person's explicit choices by item key: true collapsed, false expanded. Anything not named takes the default. */
export type CollapseChoices = Readonly<Record<string, boolean>>;

/** Where the Map keeps a person's expand and collapse choices (spec, Collapse: per project, on their device). */
export interface CollapseStore {
	read(): CollapseChoices;
	write(choices: CollapseChoices): void;
}

/** Choices in localStorage, per project. A missing, blocked, or garbled entry reads as no choices. */
export function createCollapseStore(projectRef: string): CollapseStore {
	const key = mapCollapsePref(projectRef);
	return {
		read() {
			const raw = readPref(key);
			if (!raw) return {};
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return {};
			}
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
			const choices: Record<string, boolean> = {};
			for (const [item, collapsed] of Object.entries(parsed)) if (typeof collapsed === 'boolean') choices[item] = collapsed;
			return choices;
		},
		write(choices) {
			writePref(key, JSON.stringify(choices));
		},
	};
}
