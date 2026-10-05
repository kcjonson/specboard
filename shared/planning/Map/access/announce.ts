import type { MapItemRow } from '@specboard/core/map-read';
import { STATUS_LABELS } from '@specboard/ui';
import type { MapUpdate } from '../map-update';

/**
 * Remote changes, said to a screen reader (spec, Accessibility): a polite live region, rate
 * limited, with a setting to turn it off. It listens to the same change notification the
 * canvas moves to (the model's update per applied refresh), so a push transport changes
 * nothing here.
 */

export interface ChangeSummary {
	/** The item it is about, so a burst on one item says it once. */
	key: string;
	text: string;
}

/**
 * What a model's update says a person listening would want to know: an item filed or gone, a
 * new status (finished, started, sent to review), a question to answer, a PR opened. One line
 * per item, in the order the update names them. `before` is the rows the Map showed ahead of
 * the update, which is where a removed item's title is; a bare agent write or a move the layout
 * makes for time alone says nothing.
 */
export function summarizeUpdate(update: MapUpdate, rows: ReadonlyMap<string, MapItemRow>, before: ReadonlyMap<string, MapItemRow>): ChangeSummary[] {
	const changes: ChangeSummary[] = [];
	for (const key of update.added) {
		const row = rows.get(key);
		if (row) changes.push({ key, text: `${key} ${row.title}: filed` });
	}
	for (const key of update.restyled) {
		const row = rows.get(key);
		if (!row || update.added.has(key)) continue;
		const phrases = [`now ${STATUS_LABELS[row.status]}`];
		if (row.subStatus === 'needs_input') phrases.push('needs input');
		else if (row.subStatus === 'pr_open') phrases.push('PR open');
		changes.push({ key, text: `${key} ${row.title}: ${phrases.join(', ')}` });
	}
	for (const key of update.removed) {
		const row = before.get(key);
		changes.push({ key, text: `${key}${row ? ` ${row.title}` : ''}: removed` });
	}
	return changes;
}

/** At most one announcement this often; whatever arrives in between waits and goes out as one. */
export const MIN_GAP_MS = 5_000;

/** A batch names this many changes and counts the rest. */
const NAMED = 3;

export interface AnnouncerDeps {
	/** Puts a message in the live region. */
	say(text: string): void;
	now(): number;
	/** Runs `task` after `ms`; returns a handle for `cancel`. */
	later(task: () => void, ms: number): unknown;
	cancel(handle: unknown): void;
}

export const announcementText = (changes: readonly ChangeSummary[]): string => {
	if (changes.length <= NAMED) return changes.map((change) => change.text).join('; ');
	return `${changes.length} changes: ${changes.slice(0, NAMED - 1).map((change) => change.text).join('; ')}; and ${changes.length - (NAMED - 1)} more`;
};

/**
 * The rate limit: the first change after a quiet stretch is said at once, and then changes
 * are gathered until the gap has passed and said together, newest word on an item winning.
 * Turned off, remote changes are dropped, never held back for later. `say` is for answers to
 * the person's own keys, which are not remote changes: they go out at once, on or off.
 */
export class Announcer {
	private readonly deps: AnnouncerDeps;
	private on = true;
	private lastAt = -Infinity;
	private pending = new Map<string, ChangeSummary>();
	private timer: unknown = null;

	constructor(deps: AnnouncerDeps) {
		this.deps = deps;
	}

	get enabled(): boolean {
		return this.on;
	}

	setEnabled(on: boolean): void {
		this.on = on;
		if (!on) this.drop();
	}

	push(changes: readonly ChangeSummary[]): void {
		if (!this.on || changes.length === 0) return;
		for (const change of changes) {
			// Re-set so the latest word on an item sits last.
			this.pending.delete(change.key);
			this.pending.set(change.key, change);
		}
		if (this.timer !== null) return;
		const wait = this.lastAt + MIN_GAP_MS - this.deps.now();
		if (wait <= 0) this.flush();
		else this.timer = this.deps.later(() => this.flush(), wait);
	}

	say(text: string): void {
		this.deps.say(text);
	}

	dispose(): void {
		this.drop();
	}

	private drop(): void {
		if (this.timer !== null) this.deps.cancel(this.timer);
		this.timer = null;
		this.pending = new Map();
	}

	private flush(): void {
		this.timer = null;
		if (!this.on || this.pending.size === 0) return;
		const batch = [...this.pending.values()];
		this.pending = new Map();
		this.lastAt = this.deps.now();
		this.deps.say(announcementText(batch));
	}
}
