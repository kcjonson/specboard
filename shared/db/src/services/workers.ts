/**
 * Worker service — observed agent presence on items.
 *
 * One row per (item, agent session) episode, written as a side effect of real
 * MCP writes while the item is in_progress: first write inserts, later writes
 * from the same session bump last_seen_at, moving the item out of in_progress
 * ends the episode. No heartbeat or claim call exists; staleness is derived
 * from last_seen_at at read time by consumers and never stored.
 */

import { query } from '../index.ts';
import type { AgentActor } from '../types.ts';

export interface WorkerSummary {
	id: string;
	actor: AgentActor;
	branch: string | null;
	startedAt: Date;
	lastSeenAt: Date;
}

/** Record activity by an agent session on an item: insert an episode or bump the active one. */
export async function recordWorkerActivity(
	projectId: string,
	itemNumber: number,
	actor: AgentActor,
	branch?: string
): Promise<void> {
	await query(
		`INSERT INTO item_workers (item_id, project_id, actor, branch)
		 SELECT i.id, $1, $3::jsonb, $4 FROM items i WHERE i.project_id = $1 AND i.number = $2
		 ON CONFLICT (item_id, (actor->>'userId'), (actor->>'clientId'), (COALESCE(actor->>'sessionId', ''))) WHERE ended_at IS NULL
		 DO UPDATE SET last_seen_at = now(),
			branch = COALESCE(EXCLUDED.branch, item_workers.branch),
			actor = EXCLUDED.actor`,
		[projectId, itemNumber, JSON.stringify(actor), branch ?? null]
	);
}

/** End every active episode on an item (it left in_progress). */
export async function endWorkers(projectId: string, itemNumber: number): Promise<void> {
	await query(
		`UPDATE item_workers w SET ended_at = now()
		 FROM items i
		 WHERE w.item_id = i.id AND i.project_id = $1 AND i.number = $2
		   AND w.ended_at IS NULL`,
		[projectId, itemNumber]
	);
}

/** Batch-load active episodes for many items (item-response hydration). */
export async function listActiveWorkersByItems(itemIds: string[]): Promise<Map<string, WorkerSummary[]>> {
	const result = await query<{ id: string; item_id: string; actor: AgentActor; branch: string | null; started_at: Date; last_seen_at: Date }>(
		`SELECT id, item_id, actor, branch, started_at, last_seen_at
		 FROM item_workers WHERE item_id = ANY($1) AND ended_at IS NULL
		 ORDER BY last_seen_at DESC`,
		[itemIds]
	);
	const byItem = new Map<string, WorkerSummary[]>();
	for (const r of result.rows) {
		const existing = byItem.get(r.item_id) || [];
		existing.push({ id: r.id, actor: r.actor, branch: r.branch, startedAt: r.started_at, lastSeenAt: r.last_seen_at });
		byItem.set(r.item_id, existing);
	}
	return byItem;
}

/** Active episodes on an item, most recently seen first. */
export async function listActiveWorkers(projectId: string, itemNumber: number): Promise<WorkerSummary[]> {
	const result = await query<{ id: string; actor: AgentActor; branch: string | null; started_at: Date; last_seen_at: Date }>(
		`SELECT w.id, w.actor, w.branch, w.started_at, w.last_seen_at
		 FROM item_workers w
		 JOIN items i ON i.id = w.item_id
		 WHERE i.project_id = $1 AND i.number = $2 AND w.ended_at IS NULL
		 ORDER BY w.last_seen_at DESC`,
		[projectId, itemNumber]
	);
	return result.rows.map((r) => ({ id: r.id, actor: r.actor, branch: r.branch, startedAt: r.started_at, lastSeenAt: r.last_seen_at }));
}
