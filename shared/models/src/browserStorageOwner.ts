/**
 * Ownership guard for per-project browser storage.
 *
 * Editor drafts, the last-opened file, and the file-tree expansion state are all
 * keyed by project slug. Slugs are unique per *owner*, but localStorage is per
 * *origin* — so on a shared browser two different accounts that each have a project
 * slugged `docs` would read each other's entries, and an unsaved draft from one
 * account could be offered for recovery to the next. (Project UUIDs, which these
 * keys used before slugs, were globally unique and could not collide this way.)
 *
 * Rather than thread a user id through every key, the store records which account
 * it belongs to and is emptied wholesale when a different account appears. This
 * covers logout and the no-logout case alike: whoever loads the app next either
 * matches the recorded owner or gets a clean store.
 */

const OWNER_KEY = 'storageOwner';

/** Prefixes of every entry that is scoped to a project rather than to the browser. */
const PROJECT_SCOPED_PREFIXES = ['doc.', 'editor.', 'fileBrowser.'];

function getStorage(): typeof globalThis.localStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		// localStorage throws in restricted contexts (private browsing, blocked site data).
		return null;
	}
}

/**
 * Record `userId` as the owner of this browser's project-scoped storage, clearing
 * it first if it belonged to someone else. Safe to call on every load; it only
 * clears when the owner actually changes.
 *
 * Pass nothing (or undefined) before the current user is known — this no-ops rather
 * than clearing, so a slow /users/me fetch can't wipe the signed-in user's drafts.
 *
 * @returns true if storage was cleared because the owner changed.
 */
export function claimBrowserStorage(userId: string | undefined): boolean {
	if (!userId) return false;

	const storage = getStorage();
	if (!storage) return false;

	try {
		const previous = storage.getItem(OWNER_KEY);
		if (previous === userId) return false;

		if (previous !== null) {
			const doomed: string[] = [];
			for (let i = 0; i < storage.length; i++) {
				const key = storage.key(i);
				if (key && PROJECT_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
					doomed.push(key);
				}
			}
			for (const key of doomed) storage.removeItem(key);
		}

		storage.setItem(OWNER_KEY, userId);
		return previous !== null;
	} catch {
		// A quota or security error here must not break the editor.
		return false;
	}
}
