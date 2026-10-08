import { parseItemKey } from '@specboard/core/identifiers';

/** A project on the combined Map (multi-project-view.md). */
export interface MapProject {
	/** `owner/project`, where its reads go. */
	ref: string;
	/** Its item-key prefix. Within one Map every prefix is unique (decision 5), so an item's key names its project. */
	key: string;
	name: string;
}

/** A project's own Map, which also shows what changed since the person last looked and moves their baseline as they leave. */
export interface OwnMapScope {
	projectRef: string;
}

/** The combined view of 2 to 10 projects, which only reads (multi-project-view.md, decisions 6 and 10). */
export interface CombinedMapScope {
	projects: readonly MapProject[];
}

/** Whose items a Map draws. */
export type MapScope = OwnMapScope | CombinedMapScope;

/** What the Map's reads go by, built once per scope. */
export interface MapSetup {
	/** Every project's ref, in the order given. */
	refs: readonly string[];
	/** The project an item is from. */
	refOf(itemKey: string): string;
	/** The project whose own Map this is; null on the combined view. */
	own: string | null;
}

/** What the scope says, as one string: the Map starts over only when this changes, whatever object it came in. */
export function scopeKey(scope: MapScope): string {
	return 'projectRef' in scope ? scope.projectRef : scope.projects.map((project) => `${project.key}:${project.ref}`).join(',');
}

/**
 * Throws for a combined view with two projects under one prefix: the Map's rows, selection,
 * and relations all go by item key, so the picker never offers that (decision 5).
 */
export function mapSetup(scope: MapScope): MapSetup {
	if ('projectRef' in scope) {
		const { projectRef } = scope;
		return { refs: [projectRef], refOf: () => projectRef, own: projectRef };
	}
	const byKey = new Map<string, string>();
	for (const { key, ref } of scope.projects) {
		if (byKey.has(key)) throw new Error(`Two projects on one Map can't share the prefix ${key}`);
		byKey.set(key, ref);
	}
	return {
		refs: scope.projects.map((project) => project.ref),
		refOf: (itemKey) => {
			const prefix = parseItemKey(itemKey)?.projectKey;
			const ref = prefix === undefined ? undefined : byKey.get(prefix);
			if (ref === undefined) throw new Error(`${itemKey} is from none of the projects on the Map`);
			return ref;
		},
		own: null,
	};
}
