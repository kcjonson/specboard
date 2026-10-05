import type { MapItemRow, MapItemSubStatus } from '@specboard/core/map-read';
import { STATUS_LABELS } from '@specboard/ui';
import type { DrawDot } from '../draw-list';
import { REASON_TAGS, REASON_TEXT } from '../needs-person';

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

/** One mark on a card: a word or two, with the icon some of them carry. */
export interface CardChip {
	text: string;
	icon: 'git-branch' | 'file' | null;
}

/** What a card's one row of marks has room for, in px, and what each chip costs: its padding, a glyph's width, and about this much a character. */
const CHIP_ROOM = 166;
const CHIP_PAD = 16;
const CHIP_ICON = 14;
const CHIP_CHAR = 5.9;
const CHIP_GAP = 4;
const MORE_WIDTH = 28;

const chipWidth = (chip: CardChip): number => CHIP_PAD + chip.text.length * CHIP_CHAR + (chip.icon ? CHIP_ICON : 0);

/**
 * The chips that fit one row of the card, in order, and how many were left out. When some
 * are, the last that fits gives way to a "+N" so the row says it is not the whole story.
 * The first chip, the status, is always shown.
 */
export function fitChips(chips: readonly CardChip[]): { shown: CardChip[]; hidden: number } {
	const widths = chips.map(chipWidth);
	const total = widths.reduce((sum, w) => sum + w, 0) + CHIP_GAP * Math.max(0, chips.length - 1);
	if (total <= CHIP_ROOM) return { shown: [...chips], hidden: 0 };
	let used = MORE_WIDTH;
	let count = 0;
	for (const w of widths) {
		if (count > 0 && used + w + CHIP_GAP > CHIP_ROOM) break;
		used += w + CHIP_GAP;
		count++;
	}
	return { shown: chips.slice(0, Math.max(1, count)), hidden: chips.length - Math.max(1, count) };
}

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
	/** Why the item needs a person (the ink ring on its glyph) and the short tag beside it; null when it needs nobody. */
	reason: { tag: string; text: string } | null;
	/** 1 to 3 for an item that is up next. */
	upNext: number | null;
	/** Every mark the card can carry, most important first, for `fitChips` to cut to its one row. */
	chips: CardChip[];
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
	const statusLabel = STATUS_LABELS[dot.status];
	const subStatus = row.subStatus ? (SUB_STATUS_LABELS[row.subStatus] ?? null) : null;
	const waiting = waitingOn(row);
	const pr = row.prUrl ? prLabel(row.prUrl) : null;
	const family = dot.folded ? dot.folded.count : null;
	const chips: CardChip[] = [{ text: statusLabel, icon: null }];
	if (subStatus) chips.push({ text: subStatus, icon: null });
	if (waiting) chips.push({ text: waiting, icon: null });
	if (row.specCount > 0) chips.push({ text: row.specCount === 1 ? 'Spec' : `${row.specCount} specs`, icon: 'file' });
	if (pr) chips.push({ text: pr, icon: 'git-branch' });
	if (row.textBlockerCount > 0) chips.push({ text: row.textBlockerCount === 1 ? '1 hold' : `${row.textBlockerCount} holds`, icon: null });
	if (family !== null) chips.push({ text: `${family} items`, icon: null });
	return {
		key: row.key,
		title: row.title,
		statusLabel,
		subStatus,
		waitingOn: waiting,
		holds: row.textBlockerCount,
		pr,
		specs: row.specCount,
		origin: row.originActorType === 'agent' ? 'agent' : row.originActorType === 'user' ? 'person' : null,
		family,
		reason: dot.reason ? { tag: REASON_TAGS[dot.reason], text: REASON_TEXT[dot.reason] } : null,
		upNext: dot.upNext,
		chips,
	};
}
