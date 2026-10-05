/**
 * Since your last visit (docs/specs/ai-development-overview.md): the per-account
 * baseline, and the changes dated after it. The changes are read from the item rows and
 * the transition log by their project indexes, in one statement, never item by item.
 */

import { formatItemKey } from '@specboard/core/identifiers';
import type { MapChange, MapChangeKind, MapChanges } from '@specboard/core/map-changes';
import { query } from '../index.ts';

/**
 * How far behind the statement's start the read's time is stamped. A row's timestamp is
 * taken when its transaction writes it, and the row becomes visible when that
 * transaction commits; one that stamped just before the read began but commits after it
 * took its snapshot is missed by the read, and would be missed for good if the baseline
 * moved past its stamp. Moving the baseline to a little before the read instead means such
 * a row is reported again next time, which costs a repeated line, never a lost change.
 */
export const READ_SETTLE_SECONDS = 5;

interface BaselineRow {
	baseline: Date | null;
	read_at: Date;
}

interface ChangeRow {
	number: number;
	kind: MapChangeKind;
	at: Date;
}

/**
 * Changes after $2, per item and kind. See the spec for what each kind means:
 * - filed: created after the baseline.
 * - finished: done now, and completed after the baseline (a reopened and refinished
 *   item is dated by its latest finish; one that is no longer done isn't finished).
 * - worked on: a transition, an activity-log entry, or a worker write after the baseline,
 *   on an item that wasn't filed or finished in that time (those say more).
 * - blocked: blocked or held now, by a move to blocked or an item or text blocker opened
 *   after the baseline. A blocker that opened and cleared is not a change to look at.
 * - question: needs_input now, raised by a transition after the baseline.
 * - pr_opened: a transition into pr_open after the baseline, whatever happened since:
 *   the PR is still there once the item is done.
 * Transitions that only change the sub-status under an unchanged status don't count as a
 * move to blocked, and a status move under an unchanged sub-status isn't a new question
 * or PR, so each "moved to" is tested against what it moved from.
 */
const CHANGES_SQL = `
	WITH moves AS (
		SELECT item_id,
			MAX(created_at) AS at,
			MAX(created_at) FILTER (WHERE to_status = 'blocked' AND from_status IS DISTINCT FROM 'blocked') AS blocked_at,
			MAX(created_at) FILTER (WHERE to_sub_status = 'needs_input' AND from_sub_status IS DISTINCT FROM 'needs_input') AS question_at,
			MAX(created_at) FILTER (WHERE to_sub_status = 'pr_open' AND from_sub_status IS DISTINCT FROM 'pr_open') AS pr_at
		FROM item_transitions
		WHERE project_id = $1 AND created_at > $2
		GROUP BY item_id
	),
	open_blockers AS (
		SELECT item_id, MAX(created_at) FILTER (WHERE created_at > $2) AS opened_at
		FROM item_blockers
		WHERE project_id = $1 AND cleared_at IS NULL
		GROUP BY item_id
	),
	worker_writes AS (
		SELECT item_id, MAX(last_seen_at) AS at
		FROM item_workers
		WHERE project_id = $1 AND last_seen_at > $2
		GROUP BY item_id
	)
	SELECT i.number, 'filed' AS kind, i.created_at AS at
	FROM items i
	WHERE i.project_id = $1 AND i.created_at > $2
	UNION ALL
	SELECT i.number, 'finished', i.completed_at
	FROM items i
	WHERE i.project_id = $1 AND i.status = 'done' AND i.completed_at > $2
	UNION ALL
	SELECT i.number, 'worked_on', GREATEST(m.at, w.at, n.at)
	FROM items i
	LEFT JOIN moves m ON m.item_id = i.id
	LEFT JOIN worker_writes w ON w.item_id = i.id
	LEFT JOIN LATERAL (
		SELECT MAX(created_at) AS at FROM item_notes WHERE item_id = i.id AND created_at > $2
	) n ON true
	WHERE i.project_id = $1
		AND i.created_at <= $2
		AND NOT COALESCE(i.status = 'done' AND i.completed_at > $2, false)
		AND GREATEST(m.at, w.at, n.at) IS NOT NULL
	UNION ALL
	SELECT i.number, 'blocked', GREATEST(m.blocked_at, b.opened_at)
	FROM items i
	LEFT JOIN moves m ON m.item_id = i.id
	LEFT JOIN open_blockers b ON b.item_id = i.id
	WHERE i.project_id = $1
		AND GREATEST(m.blocked_at, b.opened_at) IS NOT NULL
		AND (i.status = 'blocked' OR b.item_id IS NOT NULL)
	UNION ALL
	SELECT i.number, 'question', m.question_at
	FROM items i
	JOIN moves m ON m.item_id = i.id
	WHERE i.project_id = $1 AND m.question_at IS NOT NULL AND i.sub_status = 'needs_input'
	UNION ALL
	SELECT i.number, 'pr_opened', m.pr_at
	FROM items i
	JOIN moves m ON m.item_id = i.id
	WHERE i.project_id = $1 AND m.pr_at IS NOT NULL
	ORDER BY at, number, kind
`;

/**
 * The person's baseline and the changes since it. A person with no baseline has made no
 * visit before: they get no changes, and the read's time to set one from. The read's time
 * is the database's clock, stamped before anything is read.
 */
export async function getMapChanges(userId: string, projectId: string, projectKey: string): Promise<MapChanges> {
	const { rows: [stamp] } = await query<BaselineRow>(
		`SELECT
			(SELECT last_visit_at FROM map_baselines WHERE user_id = $1 AND project_id = $2) AS baseline,
			statement_timestamp() - make_interval(secs => $3) AS read_at`,
		[userId, projectId, READ_SETTLE_SECONDS]
	);
	const { baseline, read_at: readAt } = stamp!;
	if (baseline === null) return { baseline: null, readAt: readAt.getTime(), changes: [] };

	const { rows } = await query<ChangeRow>(CHANGES_SQL, [projectId, baseline]);
	return {
		baseline: baseline.getTime(),
		readAt: readAt.getTime(),
		changes: rows.map((row): MapChange => ({ key: formatItemKey(projectKey, row.number), kind: row.kind, at: row.at.getTime() })),
	};
}

/**
 * Moves the person's baseline forward to `readAt` (epoch ms), the moment their Map had
 * read up to, and returns where it stands. It never moves back: the stored value and the
 * sent one meet in GREATEST inside the upsert, which Postgres evaluates against the
 * row's latest committed version once it holds the row lock, so two tabs racing each
 * other can't leave the earlier of them last. It never moves past the database's own
 * clock either, since the value comes from the client. The first call creates the row.
 */
export async function advanceMapBaseline(userId: string, projectId: string, readAt: number): Promise<number> {
	const { rows: [row] } = await query<{ last_visit_at: Date }>(
		`INSERT INTO map_baselines (user_id, project_id, last_visit_at)
		 VALUES ($1, $2, LEAST(to_timestamp($3::double precision / 1000), clock_timestamp()))
		 ON CONFLICT (user_id, project_id)
		 DO UPDATE SET last_visit_at = GREATEST(map_baselines.last_visit_at, EXCLUDED.last_visit_at)
		 RETURNING last_visit_at`,
		[userId, projectId, readAt]
	);
	return row!.last_visit_at.getTime();
}
