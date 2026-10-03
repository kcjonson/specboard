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
 * An item-blocker link on the blocked item. `satisfied` is a link cleared because the
 * blocking item finished, which keeps drawing and pulling; `removed` is one someone
 * cleared by hand, which disappears from the Map.
 */
export interface MapBlockerLink {
	blockerKey: string;
	state: 'open' | 'satisfied' | 'removed';
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
	/** The item's own latest meaningful event; the subtree anchor is the layout's job. */
	timeAnchor: string;
	workers: MapWorkerEpisode[];
	blockers: MapBlockerLink[];
	textBlockerCount: number;
	discoveredFromKey: string | null;
	originActorType: 'user' | 'agent' | 'system';
	prUrl: string | null;
	specCount: number;
}
