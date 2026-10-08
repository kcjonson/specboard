import { formatProjectRef, parseProjectRef } from '@specboard/core/identifiers';
import type { ProjectLabel } from '../ProjectChip/ProjectChip';
import { MULTI_PROJECT_PREF, readPref, writePref } from '../Planning/prefs';

/** One project is just its own board. */
export const MIN_PROJECTS = 2;

/**
 * The ceiling is request volume: each project is read through its own endpoints, at five
 * requests a poll for the Board, inside a production firewall budget of about 400 requests
 * a minute per IP for the whole app (docs/specs/multi-project-view.md, decision 3).
 */
export const MAX_PROJECTS = 10;

/** The `?projects=` list, checked: the refs in the order given, or what is wrong with it. */
export type Selection = { ok: true; refs: string[] } | { ok: false; problem: string };

/**
 * Reads the `projects` query parameter: owner/project refs, comma-separated. Refs are
 * normalized the way parseProjectRef normalizes them, so a hand-typed `Acme/Roadmap` is
 * the same project as `acme/roadmap`, and an empty entry (a stray comma) is no entry.
 */
export function parseSelection(param: string | null): Selection {
	const refs: string[] = [];
	for (const entry of (param ?? '').split(',')) {
		const text = entry.trim();
		if (text === '') continue;
		const parsed = parseProjectRef(text);
		if (!parsed?.owner) return { ok: false, problem: `"${text}" isn't a project address. Addresses look like owner/project.` };
		const ref = formatProjectRef(parsed.owner, parsed.project);
		if (refs.includes(ref)) return { ok: false, problem: `${ref} is in the list twice.` };
		refs.push(ref);
	}
	if (refs.length === 0) return { ok: false, problem: "This link doesn't name any projects." };
	if (refs.length < MIN_PROJECTS) {
		return { ok: false, problem: `This link names one project, and viewing together takes at least ${MIN_PROJECTS}.` };
	}
	if (refs.length > MAX_PROJECTS) {
		return { ok: false, problem: `This link names ${refs.length} projects, and at most ${MAX_PROJECTS} can be viewed together.` };
	}
	return { ok: true, refs };
}

/** Everything besides the projects that the view's address can carry. */
export interface MultiProjectParams {
	view?: string;
	search?: string;
	type?: string;
}

/**
 * The address the projects open at together. Refs are slugs and a slash, which never
 * need encoding, so they go in as they are and the address stays readable; the rest is
 * encoded, and left off when empty.
 */
export function multiProjectUrl(refs: readonly string[], params: MultiProjectParams = {}): string {
	let url = `/planning?projects=${refs.join(',')}`;
	for (const name of ['view', 'search', 'type'] as const) {
		const value = params[name];
		if (value) url += `&${name}=${encodeURIComponent(value)}`;
	}
	return url;
}

/** A project as GET /api/projects lists it, as far as this view reads it. */
export interface ListedProject {
	ownerSlug: string;
	slug: string;
	key: string;
	name: string;
}

/** A project left out for sharing its key prefix with one chosen before it. */
export interface KeyClash {
	project: ProjectLabel;
	/** The earlier project that has the prefix. */
	holder: ProjectLabel;
}

/** A selection matched against the projects the person can read. */
export interface ResolvedSelection {
	/** What the view shows, in the order chosen. */
	projects: ProjectLabel[];
	/** Refs that aren't among them: deleted, or never readable by this person. */
	missing: string[];
	/** Projects left out because an earlier one has the same key prefix (spec decision 5). */
	clashes: KeyClash[];
}

/**
 * Picks the selection out of the readable projects. The URL can be shared, so it may
 * name projects this person can't read, and since the picker's same-prefix rule can be
 * edited out of a URL by hand, the later project of a prefix is dropped here too: item
 * keys are what the views select and look items up by, so two projects can't share one.
 */
export function resolveSelection(refs: readonly string[], listed: readonly ListedProject[]): ResolvedSelection {
	const byRef = new Map(listed.map((project) => [formatProjectRef(project.ownerSlug, project.slug), project]));
	const resolved: ResolvedSelection = { projects: [], missing: [], clashes: [] };
	for (const ref of refs) {
		const found = byRef.get(ref);
		if (!found) {
			resolved.missing.push(ref);
			continue;
		}
		const project = { ref, name: found.name, key: found.key };
		const holder = resolved.projects.find((chosen) => chosen.key === project.key);
		if (holder) resolved.clashes.push({ project, holder });
		else resolved.projects.push(project);
	}
	return resolved;
}

/** "a", "a and b", "a, b, and c". */
function listOf(names: readonly string[]): string {
	if (names.length < 3) return names.join(' and ');
	return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/**
 * What the view says about the projects it leaves out: one line for those it can't read
 * (named by ref when the projects list never had them, by name when one stopped
 * answering), and one for each key clash.
 */
export function leftOutNotices(unreadable: readonly string[], clashes: readonly KeyClash[]): string[] {
	const notices: string[] = [];
	if (unreadable.length === 1) {
		notices.push(`${unreadable[0]} isn't shown: it doesn't exist, or you can't read it.`);
	} else if (unreadable.length > 1) {
		notices.push(`${listOf(unreadable)} aren't shown: they don't exist, or you can't read them.`);
	}
	for (const { project, holder } of clashes) {
		notices.push(`${project.name} (${project.ref}) isn't shown: its key ${project.key} is already used by ${holder.name}.`);
	}
	return notices;
}

/** The refs last opened together, as stored; whatever no longer matches a project is the reader's to skip. */
export function readRememberedSelection(): string[] {
	return (readPref(MULTI_PROJECT_PREF) ?? '').split(',').filter((ref) => ref !== '');
}

export function rememberSelection(refs: readonly string[]): void {
	writePref(MULTI_PROJECT_PREF, refs.join(','));
}
