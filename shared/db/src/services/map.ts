/**
 * Map read — every item in a project at any depth, carrying only what the Map draws
 * (docs/specs/ai-development-overview.md, Data). One statement reads the whole project:
 * anchors, blocker links, and open worker episodes are aggregated per item in SQL, so
 * the cost is a handful of grouped scans, never a round trip per item.
 */

import { createHash } from 'node:crypto';
import { formatItemKey } from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import { getPeople, type Person } from './users.ts';
import type { MapBlockerLink, MapItemRow, MapItemStatus, MapItemSubStatus, MapItemType, MapRead, MapReadMark } from '@specboard/core/map-read';

/**
 * Rows one Map read returns before finished families fold, the same ceiling as a list
 * page (MAX_LIST_LIMIT).
 */
export const MAP_READ_CAP = 5000;

/** Bytes of the hash kept in a session key: 96 bits, 16 base64url characters. */
const SESSION_KEY_BYTES = 12;

/** The identity of one worker episode, as idx_item_workers_active_session keys it. */
export interface AgentSessionIdentity {
	userId: string;
	clientId: string;
	sessionId?: string | null;
}

/**
 * An opaque, stable key for one agent session: SHA-256 of the same (user, OAuth client,
 * session id) triple the worker index keys episodes by, so two sessions on one computer
 * differ and one session reads the same on every item. The JSON array is the separator:
 * no choice of characters inside the ids can make two different triples encode alike.
 * No secret: the session id is a random UUID the MCP server mints at initialize, a
 * correlation token rather than a credential, so the hash alone can't be walked back to
 * it. Truncated to 96 bits, which keeps a collision between two sessions on one project
 * out of reach (under 10^-17 at a million sessions).
 */
export function agentSessionKey(identity: AgentSessionIdentity): string {
	return createHash('sha256')
		.update(JSON.stringify([identity.userId, identity.clientId, identity.sessionId ?? '']))
		.digest()
		.subarray(0, SESSION_KEY_BYTES)
		.toString('base64url');
}

interface WorkerJson {
	userId: string;
	clientId: string;
	sessionId: string | null;
	deviceName: string | null;
	client: string | null;
	branch: string | null;
	startedMs: number;
	lastSeenMs: number;
}

interface MapQueryRow {
	project_key: string;
	number: number;
	parent_number: number | null;
	type: MapItemType;
	title: string;
	status: MapItemStatus;
	sub_status: MapItemSubStatus | null;
	blocked: boolean;
	rank: number;
	created_at: Date;
	started_at: Date | null;
	completed_at: Date | null;
	time_anchor: Date;
	text_blocker_count: number;
	discovered_from_number: number | null;
	origin_actor_type: 'user' | 'agent' | 'system' | null;
	pr_url: string | null;
	spec_count: number;
	/** [blocker number, cleared-at epoch ms or null while open] */
	links: Array<[number, number | null]>;
	workers: WorkerJson[];
}

/**
 * The time anchor is the item's latest event: completed_at for a done item, otherwise
 * (and for a done item that finished before 033 stamped completions) the newest of being
 * filed, a transition, an activity-log entry, one of its blockers opened or cleared, and
 * an observed agent write. updated_at moves on title and description edits, so it is
 * never an input.
 *
 * Blocker links resolve per pair to their latest row: an open row wins, otherwise the
 * most recent clear. A clear the system made because work finished (the blocker
 * completing, or the blocked item completing over it) is satisfied and comes back with
 * when; a clear someone made by hand drops the link, even when an older satisfied row
 * for the same pair exists, since the last word on that dependency was to remove it.
 *
 * item_transitions, item_workers, and epic_specs are read by their project indexes.
 * item_blockers has no full project index, so its rows are reached through the
 * project's item ids. item_notes has no project column at all: grouped, the planner
 * hashes the whole table, every project's log, so the newest entry is instead one probe
 * of idx_item_notes_item_created per item, and only for items the anchor still needs
 * (not one done since completions were stamped).
 *
 * A delta ($2, the cursor) scopes every aggregate to the items whose updated_at moved
 * since, plus the items whose worker episodes wrote or ended since, since a worker write
 * doesn't touch the item row. Their anchors, links, and episodes come back whole, the same
 * as in a full read, so the client recomputes what they move (a parent's subtree anchor
 * included) from the rows alone.
 */
function mapSql(delta: boolean): string {
	const scoped = delta ? 'AND item_id IN (SELECT id FROM scope)' : '';
	return `
	WITH scope AS (
		${delta
			? `SELECT id FROM items WHERE project_id = $1 AND updated_at >= $2
		UNION
		SELECT item_id FROM item_workers WHERE project_id = $1 AND (last_seen_at >= $2 OR ended_at >= $2)`
			: 'SELECT id FROM items WHERE project_id = $1'}
	),
	transition_at AS (
		SELECT item_id, MAX(created_at) AS at
		FROM item_transitions
		WHERE project_id = $1 ${scoped}
		GROUP BY item_id
	),
	blocker_rows AS MATERIALIZED (
		SELECT b.item_id, b.blocker_item_id, b.blocker_text, b.created_at, b.cleared_at, b.cleared_by
		FROM item_blockers b
		JOIN scope p ON p.id = b.item_id
	),
	blocker_at AS (
		SELECT item_id,
			MAX(GREATEST(created_at, cleared_at)) AS at,
			BOOL_OR(cleared_at IS NULL) AS any_open,
			COUNT(*) FILTER (WHERE blocker_text IS NOT NULL AND cleared_at IS NULL) AS open_text
		FROM blocker_rows
		GROUP BY item_id
	),
	latest_links AS (
		SELECT DISTINCT ON (item_id, blocker_item_id) item_id, blocker_item_id, cleared_at, cleared_by
		FROM blocker_rows
		WHERE blocker_item_id IS NOT NULL
		ORDER BY item_id, blocker_item_id, cleared_at DESC NULLS FIRST
	),
	link_lists AS (
		SELECT l.item_id,
			json_agg(
				json_build_array(bi.number, FLOOR(EXTRACT(EPOCH FROM l.cleared_at) * 1000)::bigint)
				ORDER BY bi.number
			) AS links
		FROM latest_links l
		JOIN items bi ON bi.id = l.blocker_item_id
		WHERE l.cleared_at IS NULL
			OR (l.cleared_by->>'type' = 'system' AND l.cleared_by->>'cause' IN ('blocking_item_done', 'item_completed'))
		GROUP BY l.item_id
	),
	worker_rows AS MATERIALIZED (
		SELECT id, item_id, actor, branch, started_at, last_seen_at, ended_at
		FROM item_workers
		WHERE project_id = $1 ${scoped}
	),
	worker_at AS (
		SELECT item_id, MAX(last_seen_at) AS at
		FROM worker_rows
		GROUP BY item_id
	),
	open_workers AS (
		SELECT item_id,
			json_agg(
				json_build_object(
					'userId', actor->>'userId',
					'clientId', actor->>'clientId',
					'sessionId', actor->>'sessionId',
					'deviceName', actor->>'deviceName',
					'client', actor->'client'->>'name',
					'branch', branch,
					'startedMs', FLOOR(EXTRACT(EPOCH FROM started_at) * 1000)::bigint,
					'lastSeenMs', FLOOR(EXTRACT(EPOCH FROM last_seen_at) * 1000)::bigint
				)
				ORDER BY last_seen_at DESC, id
			) AS workers
		FROM worker_rows
		WHERE ended_at IS NULL
		GROUP BY item_id
	),
	spec_counts AS (
		SELECT item_id, COUNT(*) AS spec_count
		FROM epic_specs
		WHERE project_id = $1 ${scoped}
		GROUP BY item_id
	)
	SELECT
		proj.key AS project_key,
		i.number,
		parent.number AS parent_number,
		i.type,
		i.title,
		i.status,
		i.sub_status,
		(i.status = 'blocked' OR COALESCE(b.any_open, false)) AS blocked,
		i.rank,
		i.created_at,
		i.started_at,
		i.completed_at,
		CASE
			WHEN i.status = 'done' AND i.completed_at IS NOT NULL THEN i.completed_at
			ELSE GREATEST(
				i.created_at, t.at, b.at, w.at,
				(SELECT MAX(n.created_at) FROM item_notes n WHERE n.item_id = i.id)
			)
		END AS time_anchor,
		COALESCE(b.open_text, 0)::int AS text_blocker_count,
		src.number AS discovered_from_number,
		i.origin->'actor'->>'type' AS origin_actor_type,
		i.pr_url,
		COALESCE(s.spec_count, 0)::int AS spec_count,
		COALESCE(ll.links, '[]'::json) AS links,
		COALESCE(ow.workers, '[]'::json) AS workers
	FROM items i
	JOIN projects proj ON proj.id = i.project_id
	LEFT JOIN items parent ON parent.id = i.parent_id AND parent.project_id = i.project_id
	LEFT JOIN items src ON src.id = (i.origin->'discoveredFrom'->>'itemId')::uuid AND src.project_id = i.project_id
	LEFT JOIN transition_at t ON t.item_id = i.id
	LEFT JOIN blocker_at b ON b.item_id = i.id
	LEFT JOIN worker_at w ON w.item_id = i.id
	LEFT JOIN link_lists ll ON ll.item_id = i.id
	LEFT JOIN open_workers ow ON ow.item_id = i.id
	LEFT JOIN spec_counts s ON s.item_id = i.id
	WHERE i.project_id = $1 ${delta ? 'AND i.id IN (SELECT id FROM scope)' : ''}
	ORDER BY i.number
`;
}

const FULL_SQL = mapSql(false);
const DELTA_SQL = mapSql(true);

/**
 * Where the next delta starts, taken before the read's snapshot: the database's clock a
 * second back, or the start of the oldest client transaction still open, whichever is
 * earlier. updated_at, last_seen_at, and ended_at are NOW(), the start of the transaction
 * that wrote them, and a transaction the read can't see either is open now or begins after
 * this, so its stamps are at or past the cursor even when it commits after the read. The
 * second covers a transaction that has begun but not yet published its start. The app's
 * services share one database role, so their transactions are all visible here; one held
 * open long only holds the cursor back, which costs a bigger delta, never a missed write.
 */
const CURSOR_SQL = `
	SELECT FLOOR(EXTRACT(EPOCH FROM LEAST(
		clock_timestamp() - interval '1 second',
		(SELECT MIN(xact_start) FROM pg_stat_activity
			WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid())
	)) * 1000)::bigint AS cursor
`;

/** What an updated_at delta can't see, in the read's own snapshot: deletions (by the count) and spec links. */
const SIGNALS_SQL = `
	SELECT
		(SELECT COUNT(*) FROM items WHERE project_id = $1)::int AS total,
		(SELECT COUNT(*) || ':' || COALESCE(FLOOR(EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::bigint::text, '')
			FROM epic_specs WHERE project_id = $1) AS specs
`;

const iso = (date: Date): string => date.toISOString();

function toRow(row: MapQueryRow, people: ReadonlyMap<string, Person>): MapItemRow {
	const key = (number: number): string => formatItemKey(row.project_key, number);
	return {
		key: key(row.number),
		type: row.type,
		title: row.title,
		status: row.status,
		subStatus: row.sub_status,
		blocked: row.blocked,
		parentKey: row.parent_number === null ? null : key(row.parent_number),
		rank: row.rank,
		createdAt: iso(row.created_at),
		startedAt: row.started_at ? iso(row.started_at) : null,
		completedAt: row.completed_at ? iso(row.completed_at) : null,
		timeAnchor: iso(row.time_anchor),
		workers: row.workers.map((worker) => ({
			sessionKey: agentSessionKey(worker),
			personName: people.get(worker.userId)?.name ?? null,
			deviceName: worker.deviceName,
			client: worker.client,
			branch: worker.branch,
			startedAt: iso(new Date(Number(worker.startedMs))),
			lastWriteAt: iso(new Date(Number(worker.lastSeenMs))),
		})),
		blockers: row.links.map(([number, clearedMs]) => clearedMs === null
			? { blockerKey: key(number), state: 'open' }
			: { blockerKey: key(number), state: 'satisfied', satisfiedAt: iso(new Date(Number(clearedMs))) }),
		textBlockerCount: row.text_blocker_count,
		discoveredFromKey: row.discovered_from_number === null ? null : key(row.discovered_from_number),
		originActorType: row.origin_actor_type,
		prUrl: row.pr_url,
		specCount: row.spec_count,
	};
}

interface SignalsRow {
	total: number;
	specs: string;
}

/**
 * The project for the Map: the whole of it, or with `since` (a cursor from an earlier
 * read) only what changed after it. Past the read cap a delta that found anything answers
 * with the whole read instead, since its rows can't merge into folded families; an idle
 * poll stays empty. No user, client, or session id leaves this function; an episode carries
 * the name of the person whose agent it is.
 */
export async function getProjectMap(projectId: string, since: number | null = null, cap = MAP_READ_CAP): Promise<MapRead> {
	const [taken] = (await query<{ cursor: string }>(CURSOR_SQL)).rows;
	const cursor = Number(taken!.cursor);
	// One snapshot for the signals and the rows, so the count describes exactly the rows read.
	const { signals, rows, delta } = await transaction(async (client) => {
		await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
		const [found] = (await client.query<SignalsRow>(SIGNALS_SQL, [projectId])).rows;
		if (since !== null) {
			const changed = (await client.query<MapQueryRow>(DELTA_SQL, [projectId, new Date(since)])).rows;
			if (found!.total <= cap || changed.length === 0) return { signals: found!, rows: changed, delta: true };
		}
		return { signals: found!, rows: (await client.query<MapQueryRow>(FULL_SQL, [projectId])).rows, delta: false };
	});
	const mark: MapReadMark = { cursor, total: signals.total, specs: signals.specs };
	// The people behind open episodes, by name, in one lookup for the read.
	const people = await getPeople(rows.flatMap((row) => row.workers.map((worker) => worker.userId)));
	const items = rows.map((row) => toRow(row, people));
	if (delta) return { items, summarized: false, delta: true, ...mark };
	return { ...summarizeFinishedFamilies(items, cap), delta: false, ...mark };
}

interface FamilyNode {
	row: MapItemRow;
	children: FamilyNode[];
	parent: FamilyNode | null;
	finished: boolean;
	descendants: number;
	/** Newest time anchor anywhere in the subtree, epoch ms. */
	newest: number;
}

/**
 * Past the cap, fold finished families (a parent and every descendant done) into their
 * parent's row, oldest family first, until the rows fit. Only maximal families fold, so
 * a finished sub-epic under live work folds on its own while the live parent stays.
 * Unfinished work never folds: a project whose open work alone passes the cap comes
 * back whole rather than missing items that need attention.
 *
 * A folded row stands for its family: `summarizedDescendants` counts what it holds, its
 * time anchor is the family's newest (the subtree anchor the layout would have computed
 * from the children), it carries the family's blocker links, and links or
 * discovered-from keys elsewhere that named a folded item name the row instead.
 */
export function summarizeFinishedFamilies(rows: MapItemRow[], cap: number): Pick<MapRead, 'items' | 'summarized'> {
	if (rows.length <= cap) return { items: rows, summarized: false };

	const nodes = new Map<string, FamilyNode>();
	for (const row of rows) {
		nodes.set(row.key, { row, children: [], parent: null, finished: false, descendants: 0, newest: Date.parse(row.timeAnchor) });
	}
	for (const node of nodes.values()) {
		const parent = node.row.parentKey ? nodes.get(node.row.parentKey) : undefined;
		if (parent) {
			node.parent = parent;
			parent.children.push(node);
		}
	}

	// Children before parents, built with an explicit stack: nesting has no depth limit,
	// and recursion on a deep enough tree would overflow the call stack.
	const postOrder: FamilyNode[] = [];
	const pending = [...nodes.values()].filter((node) => !node.parent);
	while (pending.length) {
		const node = pending.pop()!;
		postOrder.push(node);
		pending.push(...node.children);
	}
	postOrder.reverse();

	for (const node of postOrder) {
		node.finished = node.row.status === 'done' && node.children.every((child) => child.finished);
		for (const child of node.children) {
			node.descendants += child.descendants + 1;
			node.newest = Math.max(node.newest, child.newest);
		}
	}

	const families = postOrder
		.filter((node) => node.finished && node.children.length > 0 && !node.parent?.finished)
		.sort((a, b) => a.newest - b.newest || a.row.key.localeCompare(b.row.key, 'en', { numeric: true }));

	const foldedInto = new Map<string, FamilyNode>();
	let remaining = rows.length;
	for (const family of families) {
		if (remaining <= cap) break;
		const stack = [...family.children];
		while (stack.length) {
			const member = stack.pop()!;
			foldedInto.set(member.row.key, family);
			stack.push(...member.children);
		}
		remaining -= family.descendants;
	}
	if (!foldedInto.size) return { items: rows, summarized: false };

	const representative = (key: string): string => foldedInto.get(key)?.row.key ?? key;
	const folded = new Map<string, MapItemRow>();
	for (const family of new Set(foldedInto.values())) {
		folded.set(family.row.key, {
			...family.row,
			timeAnchor: new Date(family.newest).toISOString(),
			summarizedDescendants: family.descendants,
		});
	}

	const discoveredFrom = (row: MapItemRow): string | null => {
		const source = row.discoveredFromKey === null ? null : representative(row.discoveredFromKey);
		return source === row.key ? null : source;
	};

	const items: MapItemRow[] = [];
	const linksOf = new Map<string, Map<string, MapBlockerLink>>();
	for (const row of rows) {
		const holder = representative(row.key);
		const links = linksOf.get(holder) ?? new Map<string, MapBlockerLink>();
		linksOf.set(holder, links);
		for (const link of row.blockers) {
			const blockerKey = representative(link.blockerKey);
			if (blockerKey === holder) continue;
			const prior = links.get(blockerKey);
			if (!prior || linkOutranks(link, prior)) links.set(blockerKey, { ...link, blockerKey });
		}
		if (foldedInto.has(row.key)) continue;
		items.push(folded.get(row.key) ?? row);
	}

	return {
		items: items.map((row) => ({
			...row,
			discoveredFromKey: discoveredFrom(row),
			blockers: [...linksOf.get(row.key)!.values()]
				.sort((a, b) => a.blockerKey.localeCompare(b.blockerKey, 'en', { numeric: true })),
		})),
		summarized: true,
	};
}

/** Two links to one blocker merged by folding: open beats satisfied, then the later clear wins. */
function linkOutranks(link: MapBlockerLink, prior: MapBlockerLink): boolean {
	if (link.state !== prior.state) return link.state === 'open';
	return link.state === 'satisfied' && prior.state === 'satisfied' && link.satisfiedAt > prior.satisfiedAt;
}
