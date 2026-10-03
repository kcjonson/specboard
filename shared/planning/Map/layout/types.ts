import type { MapItemRow } from '@specboard/core/map-read';

/** Every item is in exactly one phase (spec: Phases and up next). */
export type MapPhase = 'done' | 'in_flight' | 'next' | 'later';

export interface MapPoint {
	x: number;
	y: number;
}

/**
 * Time to x, serializable so the worker can hand it to the main thread. x = 0 is the
 * edge (now, or an hour past the last activity when the board has gone quiet) and the
 * past runs left into negative x. `timeToX` evaluates it.
 */
export interface MapTimeScale {
	/** Epoch ms that maps to x = 0. */
	edge: number;
	/** Layout units per unit of warped time; the width fit sets it. */
	unit: number;
	/** Log scale time constant, ms. */
	tau: number;
	/** Weight of the equalized scale in the blend, 0 to 1. */
	equalized: number;
	/** Every item's subtree anchor, ascending: the sample the equalized scale counts. */
	times: number[];
	/** Log-scale value of the oldest anchor, so both scales span the same range. */
	logSpan: number;
}

export interface MapBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/** What a later local pass reuses so nothing rescales. */
export interface MapLayoutFrame {
	scale: MapTimeScale;
	/** Extent of the settled Map in layout units, the reserved strip past now included. */
	bounds: MapBounds;
	/** The edge sits at the last activity rather than now (see MapQuiet). */
	quiet: boolean;
}

export interface MapLayoutInput {
	rows: readonly MapItemRow[];
	/** Epoch ms. */
	now: number;
	/** A person's explicit expand (false) and collapse (true) choices, by item key. */
	collapse: Readonly<Record<string, boolean>>;
	/** Plot width over height; the two-pass width fit matches it. Ignored by a local pass. */
	aspect: number;
	/**
	 * Present for a local pass: start from these positions and move only what changed.
	 * A board that went quiet or woke up since gets a cold pass instead, since its edge moved.
	 */
	previous?: MapLayoutPrevious;
}

export interface MapLayoutPrevious {
	frame: MapLayoutFrame;
	/** Node positions from the previous layout, by node key. */
	positions: Readonly<Record<string, MapPoint>>;
	/** Item keys that changed since the previous layout. */
	changed: readonly string[];
}

export type MapNodeKind = 'item' | 'session' | 'computer';

/**
 * One placed node. Items are keyed by item key, sessions as `session:<session key>`,
 * and computers as `computer:<device name>`.
 */
export interface MapNode extends MapPoint {
	key: string;
	kind: MapNodeKind;
	r: number;
	/** An item with visible children: an unseen center the renderer draws a region around. */
	hub: boolean;
}

export interface MapTick {
	time: number;
	x: number;
}

/** No activity for more than 12 hours: the Map ends at the edge and shows a break to now. */
export interface MapQuiet {
	/** Newest time anchor on the board. */
	since: number;
	until: number;
}

export interface MapRegion {
	/** The hub item's key. */
	key: string;
	/** The enclosing region's key, null at the top level. */
	parentKey: string | null;
	depth: number;
	/** Every dot drawn inside it, nested regions' dots included. */
	members: string[];
}

export interface MapChainLink {
	blocker: string;
	blocked: string;
	satisfied: boolean;
}

/** Siblings linked by blockers, open or satisfied, inside one family. */
export interface MapChain {
	parentKey: string;
	/** In dependency order, so a chain reads in the order the work can happen. */
	items: string[];
	links: MapChainLink[];
}

export interface MapSession {
	key: string;
	device: string;
	client: string | null;
	lastWriteAt: number;
	/** 1-based within its computer. */
	number: number;
	/** Item keys it's working on (the dot may be a collapsed ancestor; see `representative`). */
	items: string[];
}

export interface MapComputer {
	device: string;
	/** Session keys, in number order. */
	sessions: string[];
}

export interface MapLayout {
	nodes: MapNode[];
	frame: MapLayoutFrame;
	/** A tick per day back from the edge; the ruler keeps those at least 90 px apart. */
	ticks: MapTick[];
	quiet: MapQuiet | null;
	phases: Record<string, MapPhase>;
	/** The three up-next markers, numbered by position. */
	upNext: string[];
	/** Every next and later item, up next first, then by rank, parent before children. */
	planOrder: string[];
	/** Every item key to the key of the node that draws it. */
	representative: Record<string, string>;
	/** Parents drawn as a dot with their family folded in. */
	collapsed: string[];
	regions: MapRegion[];
	chains: MapChain[];
	/** Items in a cycle of open blockers. */
	deadlocked: string[];
	sessions: MapSession[];
	computers: MapComputer[];
	stats: MapLayoutStats;
}

export interface MapLayoutStats {
	ticks: number;
	/** Largest single-axis move any node made on the last tick. */
	settle: number;
}
