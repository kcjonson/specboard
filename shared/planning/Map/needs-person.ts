import type { MapItemRow } from '@specboard/core/map-read';

/**
 * The items that wear the needs-a-person ink ring (spec, Needs a person), as far as an
 * item's own row tells: an agent's question, work waiting on review, and a text
 * blocker, which is a human hold by definition. Finished work needs nobody. Stale
 * sessions and blocker cycles need the sessions and the blocker graph, and join this
 * set with the tasks that draw those.
 */
export function needsPerson(rows: Iterable<MapItemRow>): Set<string> {
	const keys = new Set<string>();
	for (const row of rows) {
		if (row.status === 'done') continue;
		if (row.subStatus === 'needs_input' || row.subStatus === 'pr_open' || row.status === 'in_review' || row.textBlockerCount > 0) {
			keys.add(row.key);
		}
	}
	return keys;
}
