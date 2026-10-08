/**
 * Per-browser planning preferences (the active view, table toggles, the Map's
 * collapsed families, whether it announces remote changes, the last projects viewed
 * together). Stored in localStorage, which can be missing or throw (private mode,
 * blocked storage); a read then yields undefined and a write is dropped, and the UI
 * falls back to its default without complaint.
 */

export const VIEW_PREF = 'specboard.planning.view';
export const SHOW_DONE_PREF = 'specboard.planning.showDone';
/** The projects last opened together, as comma-separated refs; the picker starts from them. */
export const MULTI_PROJECT_PREF = 'specboard.planning.multiProject';
/** Whether the Map says remote changes aloud to a screen reader: on unless this reads `false`, and per device, not per project. */
export const MAP_ANNOUNCE_PREF = 'specboard.planning.mapAnnounce';
/** The Map's expand and collapse choices are per project, and the combined view's per set of projects, whatever order they were picked in. */
export const mapCollapsePref = (projectRefs: readonly string[]): string => `specboard.planning.mapCollapse.${[...projectRefs].sort().join(',')}`;

export function readPref(key: string): string | undefined {
	try {
		return globalThis.localStorage?.getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

export function writePref(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		// Storage can be blocked; the in-memory state still carries the choice.
	}
}
