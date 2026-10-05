import type { MapItemRow } from '@specboard/core/map-read';
import type { MapLayout } from './layout/types';

/**
 * Why an item needs a person (spec, Needs a person): an agent's question, a deadlock of
 * blockers that wait on each other, a text blocker (a hold that clears only when someone
 * removes it), work waiting on review, and an agent that went quiet.
 */
export type NeedsReason = 'question' | 'cycle' | 'hold' | 'review' | 'quiet';

/** Most pressing first: an item's lead reason picks the tag on the ring and opens the quick card. */
export const REASON_ORDER: readonly NeedsReason[] = ['question', 'cycle', 'hold', 'review', 'quiet'];

/** The short mark beside the ring when zoomed in. A deadlock is a hold nobody can lift, so it shares the `!`. */
export const REASON_TAGS: Record<NeedsReason, string> = { question: '?', cycle: '!', hold: '!', review: 'PR', quiet: 'zz' };

/** The reason in words, for the quick card to lead with and the card's assistive text. */
export const REASON_TEXT: Record<NeedsReason, string> = {
	question: 'An agent asked a question',
	cycle: 'Deadlocked: blockers wait on each other',
	hold: 'Held by a text blocker',
	review: 'Waiting on review',
	quiet: 'The agent went quiet',
};

/** Every item that needs a person, with its reasons, most pressing first. */
export type NeedsPersonReasons = ReadonlyMap<string, readonly NeedsReason[]>;

/**
 * The items that wear the ink ring, and why, as far as the read tells. Finished work
 * needs nobody. The blocker cycles come from the layout, which finds them as strongly
 * connected components of the open blockers.
 */
export function needsPerson(rows: Iterable<MapItemRow>, layout: Pick<MapLayout, 'deadlocked'>): NeedsPersonReasons {
	const found = new Map<string, Set<NeedsReason>>();
	const add = (key: string, reason: NeedsReason): void => {
		const reasons = found.get(key);
		if (reasons) reasons.add(reason);
		else found.set(key, new Set([reason]));
	};
	const deadlocked = new Set(layout.deadlocked);
	for (const row of rows) {
		if (row.status === 'done') continue;
		if (row.subStatus === 'needs_input') add(row.key, 'question');
		if (deadlocked.has(row.key)) add(row.key, 'cycle');
		if (row.textBlockerCount > 0) add(row.key, 'hold');
		if (row.subStatus === 'pr_open' || row.status === 'in_review') add(row.key, 'review');
	}
	const ordered = new Map<string, readonly NeedsReason[]>();
	for (const [key, reasons] of found) ordered.set(key, REASON_ORDER.filter((reason) => reasons.has(reason)));
	return ordered;
}

/** The short tag for a set of reasons: the lead one's. */
export function tagOf(reasons: readonly NeedsReason[]): string {
	return REASON_TAGS[reasons[0]!];
}

/** Every reason in words, lead first, for one line. */
export function reasonsText(reasons: readonly NeedsReason[]): string {
	return reasons.map((reason) => REASON_TEXT[reason]).join('; ');
}
