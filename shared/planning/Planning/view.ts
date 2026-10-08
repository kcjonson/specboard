import { useCallback, useEffect, useState } from 'preact/hooks';
import { navigate } from '@specboard/router';
import type { PlanningView } from '../ViewToggle/ViewToggle';
import { withQuery } from '../utils/address';
import { VIEW_PREF, readPref, writePref } from './prefs';

/** Below this width the Map isn't offered (spec decision 8). The same 768px as the CSS breakpoint. */
export const SMALL_SCREEN_QUERY = '(width < 768px)';

const VIEWS: readonly string[] = ['board', 'table', 'map'];

function isView(value: string | null | undefined): value is PlanningView {
	return value !== null && value !== undefined && VIEWS.includes(value);
}

/**
 * The view the person asked for. An explicit `?view=` wins so links stay shareable and
 * back/forward lands where it should; without one, fall back to whichever view they
 * last picked, then to the board.
 */
export function readView(): PlanningView {
	const param = new URLSearchParams(window.location.search).get('view');
	if (isView(param)) return param;
	const stored = readPref(VIEW_PREF);
	return isView(stored) ? stored : 'board';
}

/** What actually shows: the Map asked for on a small screen is the Board. */
export function resolveView(requested: PlanningView, small: boolean): PlanningView {
	return requested === 'map' && small ? 'board' : requested;
}

/** Whether the window is under the small-screen breakpoint, following it as the window resizes. */
export function useSmallScreen(): boolean {
	const [query] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(SMALL_SCREEN_QUERY) : null));
	const [small, setSmall] = useState(query?.matches ?? false);
	useEffect(() => {
		if (!query) return;
		const onChange = (): void => setSmall(query.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, [query]);
	return small;
}

export interface PlanningViewState {
	/** The view on screen. */
	view: PlanningView;
	/** Under the small-screen breakpoint, where the toggle leaves the Map out. */
	small: boolean;
	changeView: (next: PlanningView) => void;
}

/**
 * The active view of a planning page, one project's or several projects' alike. The Map
 * asked for on a small screen shows the Board without forgetting the request, so widening
 * the window brings the Map back. The router re-renders a page on Back and Forward without
 * remounting it, so the view follows `?view=` there too rather than drifting from it.
 */
export function usePlanningView(): PlanningViewState {
	const [requested, setRequested] = useState<PlanningView>(() => readView());
	const small = useSmallScreen();

	useEffect(() => {
		const syncView = (): void => setRequested(readView());
		window.addEventListener('popstate', syncView);
		return () => window.removeEventListener('popstate', syncView);
	}, []);

	// The view is always written explicitly so a history entry is never ambiguous, and a
	// Map anchor means nothing on the other views.
	const changeView = useCallback((next: PlanningView): void => {
		setRequested(next);
		writePref(VIEW_PREF, next);
		navigate(withQuery(window.location, next === 'map' ? { view: next } : { view: next, focus: undefined }));
	}, []);

	return { view: resolveView(requested, small), small, changeView };
}
