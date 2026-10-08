import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { navigate } from '@specboard/router';
import { formatProjectRef } from '@specboard/core/identifiers';
import { MAX_PROJECTS, MIN_PROJECTS, multiProjectUrl, readRememberedSelection, rememberSelection } from '@shared/planning';
import type { Project } from '../ProjectCard/ProjectCard';

/** The projects page's picker for viewing projects together (docs/specs/multi-project-view.md, decision 1). */
export interface ProjectPicker {
	/** Whether the page is choosing projects rather than opening one. */
	active: boolean;
	/** Chosen refs, in the order chosen: the order the view breaks its ties by. */
	chosen: readonly string[];
	/** Why the last pick was refused, until the next change. */
	refusal: string | null;
	/** Whether the chosen projects can be opened together. */
	ready: boolean;
	/** The button that starts picking, which focus goes back to when it's cancelled. */
	triggerRef: RefObject<HTMLButtonElement>;
	start(): void;
	cancel(): void;
	toggle(project: Project): void;
	isChosen(project: Project): boolean;
	/** Remembers the chosen projects and opens them together. */
	view(): void;
}

function refOf(project: Project): string {
	return formatProjectRef(project.ownerSlug, project.slug);
}

/**
 * The last set opened together, as far as it still stands among `projects`: refs no
 * longer listed are skipped, as is a later project whose key prefix an earlier one has
 * taken (keys are editable, so two that were apart can collide since).
 */
function remembered(projects: readonly Project[]): string[] {
	const byRef = new Map(projects.map((project) => [refOf(project), project]));
	const chosen: Project[] = [];
	for (const ref of readRememberedSelection()) {
		if (chosen.length === MAX_PROJECTS) break;
		const project = byRef.get(ref);
		if (project && !chosen.some((other) => other.key === project.key)) chosen.push(project);
	}
	return chosen.map(refOf);
}

export function useProjectPicker(projects: readonly Project[]): ProjectPicker {
	const [active, setActive] = useState(false);
	const [chosen, setChosen] = useState<readonly string[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const cancelled = useRef(false);

	const start = useCallback((): void => {
		setChosen(remembered(projects));
		setRefusal(null);
		setActive(true);
	}, [projects]);

	const cancel = useCallback((): void => {
		cancelled.current = true;
		setActive(false);
	}, []);

	// Leaving by Cancel or Escape hands focus back to the button that started it, which
	// the page has just rendered again in place of the bar.
	useEffect(() => {
		if (active || !cancelled.current) return;
		cancelled.current = false;
		triggerRef.current?.focus();
	}, [active]);

	useEffect(() => {
		if (!active) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') cancel();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [active, cancel]);

	const toggle = useCallback((project: Project): void => {
		const ref = refOf(project);
		if (chosen.includes(ref)) {
			setChosen(chosen.filter((other) => other !== ref));
			setRefusal(null);
			return;
		}
		if (chosen.length === MAX_PROJECTS) {
			setRefusal(`You can view up to ${MAX_PROJECTS} projects together.`);
			return;
		}
		// Item keys are unique per owner only, so a project shared with you can carry the
		// prefix of one of your own, and the view keys everything on item keys.
		const holder = projects.find((other) => other.key === project.key && chosen.includes(refOf(other)));
		if (holder) {
			setRefusal(`${project.key} is already used by ${holder.name}; pick one of them.`);
			return;
		}
		setChosen([...chosen, ref]);
		setRefusal(null);
	}, [chosen, projects]);

	const isChosen = useCallback((project: Project): boolean => chosen.includes(refOf(project)), [chosen]);

	const ready = chosen.length >= MIN_PROJECTS && chosen.length <= MAX_PROJECTS;

	const view = useCallback((): void => {
		if (!ready) return;
		rememberSelection(chosen);
		navigate(multiProjectUrl(chosen));
	}, [chosen, ready]);

	return { active, chosen, refusal, ready, triggerRef, start, cancel, toggle, isChosen, view };
}
