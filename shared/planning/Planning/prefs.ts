/**
 * Per-browser planning preferences (the active view, table toggles). Stored in
 * localStorage, which can be missing or throw (private mode, blocked storage);
 * a read then yields undefined and a write is dropped, and the UI falls back to
 * its default without complaint.
 */

export const VIEW_PREF = 'specboard.planning.view';
export const SHOW_DONE_PREF = 'specboard.planning.showDone';

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
