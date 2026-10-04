import type { MapItemRow, MapItemSubStatus } from '@specboard/core/map-read';
import { STATUS_LABELS } from '@specboard/ui';
import type { DrawDot } from '../draw-list';

/**
 * What a near-zoom card says, from an item's row (spec, Status encoding): every
 * distinction the glyph's shape and the ring carry on the canvas, written out, plus
 * the two things only a card has room for, the linked spec and who made the item.
 */

/** The sub-statuses that change what a person should do, in the words the board uses. */
const SUB_STATUS_LABELS: Partial<Record<MapItemSubStatus, string>> = {
	scoping: 'Scoping',
	pr_open: 'PR open',
	needs_input: 'Needs input',
	paused: 'Paused',
};

/** A card names this many blockers and then counts the rest. */
const NAMED_BLOCKERS = 2;

export interface CardContent {
	key: string;
	title: string;
	/** The status in words, for the glyph's label and the card's own. */
	statusLabel: string;
	subStatus: string | null;
	/** Open item blockers by key, "SPE-4, SPE-9 and 1 more", or the plain word when the hold has no item behind it. */
	waitingOn: string | null;
	/** Text blockers are a human hold; their text isn't in the Map's read, so the count is what a card has. */
	holds: number;
	/** The PR as a short mark: "PR #12" when the URL names a pull request, "PR" otherwise. */
	pr: string | null;
	specs: number;
	/** Who filed it; null when nothing says (older than provenance) or the system did. */
	origin: 'agent' | 'person' | null;
	/** An item with its family folded in: how many items that is, itself included. */
	family: number | null;
	needsPerson: boolean;
}

function prLabel(url: string): string {
	const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
	return match ? `PR #${match[1]}` : 'PR';
}

function waitingOn(row: MapItemRow): string | null {
	const open = row.blockers.filter((link) => link.state === 'open').map((link) => link.blockerKey);
	if (open.length === 0) return row.blocked && row.textBlockerCount === 0 ? 'Blocked' : null;
	const named = open.slice(0, NAMED_BLOCKERS).join(', ');
	return open.length > NAMED_BLOCKERS ? `Waiting on ${named} and ${open.length - NAMED_BLOCKERS} more` : `Waiting on ${named}`;
}

export function cardContent(row: MapItemRow, dot: DrawDot): CardContent {
	return {
		key: row.key,
		title: row.title,
		statusLabel: STATUS_LABELS[dot.status],
		subStatus: row.subStatus ? (SUB_STATUS_LABELS[row.subStatus] ?? null) : null,
		waitingOn: waitingOn(row),
		holds: row.textBlockerCount,
		pr: row.prUrl ? prLabel(row.prUrl) : null,
		specs: row.specCount,
		origin: row.originActorType === 'agent' ? 'agent' : row.originActorType === 'user' ? 'person' : null,
		family: dot.folded ? dot.folded.count : null,
		needsPerson: dot.needsPerson,
	};
}
