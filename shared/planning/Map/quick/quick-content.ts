import type { MapItemRow, MapItemSubStatus } from '@specboard/core/map-read';
import { STATUS_LABELS, glyphStatus } from '@specboard/ui';
import type { Rollup } from '../draw-list';
import type { QuickSession } from './agent-content';

/**
 * What the quick card says (spec, Navigation and interaction): title, status,
 * sub-status, sessions, blockers, progress, and the latest activity-log entry, which is
 * fetched on demand and isn't here. Its size is known from the content before it
 * renders, so placement doesn't have to measure it.
 */

const SUB_STATUS_LABELS: Partial<Record<MapItemSubStatus, string>> = {
	scoping: 'Scoping',
	in_development: 'In development',
	paused: 'Paused',
	needs_input: 'Needs input',
	pr_open: 'PR open',
};

/** The card names this many blockers and counts the rest. */
export const NAMED_BLOCKERS = 3;

/** And this many sessions, two lines each. */
export const NAMED_SESSIONS = 2;

export interface QuickBlocker {
	key: string;
	/** Empty when the blocker isn't on the Map (a folded-away row). */
	title: string;
}

export interface QuickContent {
	key: string;
	title: string;
	status: ReturnType<typeof glyphStatus>;
	statusLabel: string;
	subStatus: string | null;
	/** The open agent sessions on the item, newest write first: client, device, branch, time on the item, and time since the last write. */
	sessions: QuickSession[];
	/** Sessions past the ones named. */
	moreSessions: number;
	/** Open item blockers, the first few of them. */
	blockers: QuickBlocker[];
	/** Open blockers past the ones named. */
	moreBlockers: number;
	/** Text blockers, a human hold whose text the read doesn't carry. */
	holds: number;
	/** The family's items by phase when the item has children, otherwise null. */
	progress: Rollup | null;
}

export function quickContent(row: MapItemRow, rows: ReadonlyMap<string, MapItemRow>, progress: Rollup | null, sessions: readonly QuickSession[]): QuickContent {
	const status = glyphStatus(row.status, row.blocked);
	const open = row.blockers.filter((link) => link.state === 'open');
	return {
		key: row.key,
		title: row.title,
		status,
		statusLabel: STATUS_LABELS[status],
		subStatus: row.subStatus ? (SUB_STATUS_LABELS[row.subStatus] ?? null) : null,
		sessions: sessions.slice(0, NAMED_SESSIONS),
		moreSessions: Math.max(0, sessions.length - NAMED_SESSIONS),
		blockers: open.slice(0, NAMED_BLOCKERS).map((link) => ({ key: link.blockerKey, title: rows.get(link.blockerKey)?.title ?? '' })),
		moreBlockers: Math.max(0, open.length - NAMED_BLOCKERS),
		holds: row.textBlockerCount,
		progress,
	};
}

export const QUICK_WIDTH = 288;

/** Every part's height in px; the card's CSS gives each exactly this, so the sum is the card. */
const PAD = 12;
const GAP = 6;
const HEAD = 18;
const TITLE = 36;
const CHIPS = 20;
const LINE = 16;
const SESSION = 32;
const PROGRESS = 18;
const ACTIVITY = 64;

/** The card's height for this content: fixed parts, plus two lines for each session, a line each for the rest of the sessions, blockers, and holds, plus the progress bar. */
export function quickHeight(content: QuickContent): number {
	const lines = (content.moreSessions > 0 ? 1 : 0) + content.blockers.length + (content.moreBlockers > 0 ? 1 : 0) + (content.holds > 0 ? 1 : 0);
	const parts = [HEAD, TITLE, CHIPS, ...Array<number>(content.sessions.length).fill(SESSION), ...Array<number>(lines).fill(LINE), ...(content.progress ? [PROGRESS] : []), ACTIVITY];
	return 2 * PAD + parts.reduce((sum, part) => sum + part, 0) + GAP * (parts.length - 1);
}

/** Items done out of every item in the family, for the progress line. */
export function progressText(rollup: Rollup): string {
	const total = rollup.done + rollup.in_flight + rollup.next + rollup.later;
	return `${rollup.done} of ${total} done`;
}
