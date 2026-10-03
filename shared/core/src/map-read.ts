/**
 * The whole-project read the Map draws from (docs/specs/ai-development-overview.md,
 * Data, requirement 5): every item at any depth, carrying only what the Map draws.
 * The API produces these rows and the planning client lays them out, so the shape
 * lives here where both can import it. Times are ISO 8601 strings, as JSON sends them.
 */

export type MapItemType = 'epic' | 'task' | 'bug';

export type MapItemStatus = 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done';

export type MapItemSubStatus =
	| 'not_started'
	| 'scoping'
	| 'in_development'
	| 'paused'
	| 'needs_input'
	| 'pr_open'
	| 'complete';

/**
 * An item-blocker link on the blocked item. `satisfied` is a link the system cleared
 * because the work finished (the blocker completed, or the blocked item completed over
 * it), which keeps drawing and pulling. A link someone removed by hand isn't sent at all.
 */
export interface MapBlockerLink {
	blockerKey: string;
	state: 'open' | 'satisfied';
	/** When a satisfied link cleared; absent on an open one. */
	satisfiedAt?: string;
}

/** An open agent-session episode on an item. */
export interface MapWorkerEpisode {
	/** Opaque per-session key derived server-side; never the MCP session id. */
	sessionKey: string;
	deviceName: string | null;
	client: string | null;
	branch: string | null;
	lastWriteAt: string;
}

export interface MapItemRow {
	key: string;
	type: MapItemType;
	title: string;
	status: MapItemStatus;
	subStatus: MapItemSubStatus | null;
	/** Status is blocked, or an open blocker row exists (item or text). */
	blocked: boolean;
	parentKey: string | null;
	rank: number;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	/**
	 * The item's own latest meaningful event: completed_at when done, otherwise (and for
	 * an item done before completions were stamped) the newest of filed, a transition, an
	 * activity-log entry, a blocker opened or cleared, and an agent write. Never
	 * updated_at. The subtree anchor is the layout's job.
	 */
	timeAnchor: string;
	workers: MapWorkerEpisode[];
	blockers: MapBlockerLink[];
	textBlockerCount: number;
	discoveredFromKey: string | null;
	/** Who filed it; null for an item filed before provenance was recorded (migration 025). */
	originActorType: 'user' | 'agent' | 'system' | null;
	prUrl: string | null;
	specCount: number;
	/**
	 * Present only on a finished family folded into one row past the read cap: how many
	 * descendants it holds. Its time anchor is then the family's newest, and links that
	 * named a folded member name this row.
	 */
	summarizedDescendants?: number;
}

/** The whole-project read, as rows. GET /api/projects/:owner/:project/map sends it as a MapReadWire. */
export interface MapRead {
	items: MapItemRow[];
	/** True when the project passed the read cap and finished families came back folded. */
	summarized: boolean;
}

/** An open link is the blocker's number; a satisfied one is [number, cleared at, epoch ms]. */
export type MapBlockerLinkWire = number | [number, number];

/**
 * What GET /map sends: the read in columns, one array per field indexed by row, with
 * item keys as their numbers under `projectKey` and times as epoch milliseconds. Field
 * names, key prefixes, and ISO strings repeat on every row of an array of objects; in
 * columns 2,000 items come to about 73 KB gzipped where objects took 106 KB.
 * decodeMapRead turns it back into rows.
 */
export interface MapReadWire {
	projectKey: string;
	summarized: boolean;
	number: number[];
	type: MapItemType[];
	title: string[];
	status: MapItemStatus[];
	subStatus: (MapItemSubStatus | null)[];
	blocked: boolean[];
	parent: (number | null)[];
	rank: number[];
	createdAt: number[];
	startedAt: (number | null)[];
	completedAt: (number | null)[];
	timeAnchor: number[];
	workers: MapWorkerEpisode[][];
	blockers: MapBlockerLinkWire[][];
	textBlockerCount: number[];
	discoveredFrom: (number | null)[];
	originActorType: MapItemRow['originActorType'][];
	prUrl: (string | null)[];
	specCount: number[];
	summarizedDescendants: (number | null)[];
}

const msOf = (iso: string): number => Date.parse(iso);
const msOrNull = (iso: string | null): number | null => (iso === null ? null : msOf(iso));
const isoOf = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : isoOf(ms));

export function encodeMapRead(read: MapRead, projectKey: string): MapReadWire {
	const prefix = `${projectKey}-`;
	const numberOf = (key: string): number => {
		const number = key.startsWith(prefix) ? Number(key.slice(prefix.length)) : NaN;
		if (!Number.isSafeInteger(number)) throw new Error(`${key} is not an item key in ${projectKey}`);
		return number;
	};
	const rows = read.items;
	return {
		projectKey,
		summarized: read.summarized,
		number: rows.map((r) => numberOf(r.key)),
		type: rows.map((r) => r.type),
		title: rows.map((r) => r.title),
		status: rows.map((r) => r.status),
		subStatus: rows.map((r) => r.subStatus),
		blocked: rows.map((r) => r.blocked),
		parent: rows.map((r) => (r.parentKey === null ? null : numberOf(r.parentKey))),
		rank: rows.map((r) => r.rank),
		createdAt: rows.map((r) => msOf(r.createdAt)),
		startedAt: rows.map((r) => msOrNull(r.startedAt)),
		completedAt: rows.map((r) => msOrNull(r.completedAt)),
		timeAnchor: rows.map((r) => msOf(r.timeAnchor)),
		workers: rows.map((r) => r.workers),
		blockers: rows.map((r) => r.blockers.map((link): MapBlockerLinkWire => (link.state === 'open'
			? numberOf(link.blockerKey)
			: [numberOf(link.blockerKey), msOf(link.satisfiedAt!)]))),
		textBlockerCount: rows.map((r) => r.textBlockerCount),
		discoveredFrom: rows.map((r) => (r.discoveredFromKey === null ? null : numberOf(r.discoveredFromKey))),
		originActorType: rows.map((r) => r.originActorType),
		prUrl: rows.map((r) => r.prUrl),
		specCount: rows.map((r) => r.specCount),
		summarizedDescendants: rows.map((r) => r.summarizedDescendants ?? null),
	};
}

export function decodeMapRead(wire: MapReadWire): MapRead {
	const key = (number: number): string => `${wire.projectKey}-${number}`;
	const items = wire.number.map((number, i): MapItemRow => {
		const parent = wire.parent[i]!;
		const discoveredFrom = wire.discoveredFrom[i]!;
		const summarizedDescendants = wire.summarizedDescendants[i]!;
		return {
			key: key(number),
			type: wire.type[i]!,
			title: wire.title[i]!,
			status: wire.status[i]!,
			subStatus: wire.subStatus[i]!,
			blocked: wire.blocked[i]!,
			parentKey: parent === null ? null : key(parent),
			rank: wire.rank[i]!,
			createdAt: isoOf(wire.createdAt[i]!),
			startedAt: isoOrNull(wire.startedAt[i]!),
			completedAt: isoOrNull(wire.completedAt[i]!),
			timeAnchor: isoOf(wire.timeAnchor[i]!),
			workers: wire.workers[i]!,
			blockers: wire.blockers[i]!.map((link): MapBlockerLink => (typeof link === 'number'
				? { blockerKey: key(link), state: 'open' }
				: { blockerKey: key(link[0]), state: 'satisfied', satisfiedAt: isoOf(link[1]) })),
			textBlockerCount: wire.textBlockerCount[i]!,
			discoveredFromKey: discoveredFrom === null ? null : key(discoveredFrom),
			originActorType: wire.originActorType[i]!,
			prUrl: wire.prUrl[i]!,
			specCount: wire.specCount[i]!,
			...(summarizedDescendants === null ? {} : { summarizedDescendants }),
		};
	});
	return { items, summarized: wire.summarized };
}
