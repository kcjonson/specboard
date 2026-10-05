import type { MapItemRow } from '@specboard/core/map-read';
import { agentState } from './agents';

/**
 * The items that wear the needs-a-person ink ring (spec, Needs a person), as far as an
 * item's own row tells: an agent's question, work waiting on review, a text blocker,
 * which is a human hold by definition, and in-progress work whose sessions have all
 * gone quiet, which is what an agent that crashed looks like. Finished work needs
 * nobody. Blocker cycles need the blocker graph, and join this set with the tasks that
 * draw those.
 */
export function needsPerson(rows: Iterable<MapItemRow>, now: number): Set<string> {
	const keys = new Set<string>();
	for (const row of rows) {
		if (row.status === 'done') continue;
		if (row.subStatus === 'needs_input' || row.subStatus === 'pr_open' || row.status === 'in_review' || row.textBlockerCount > 0 || abandoned(row, now)) {
			keys.add(row.key);
		}
	}
	return keys;
}

const abandoned = (row: MapItemRow, now: number): boolean =>
	row.status === 'in_progress' && row.workers.length > 0 && row.workers.every((worker) => agentState(Date.parse(worker.lastWriteAt), now) !== 'live');
