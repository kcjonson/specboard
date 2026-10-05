import type { MapItemRow } from '@specboard/core/map-read';
import { MINUTE, SESSION_LIVE, SESSION_QUIET } from './layout/constants';
import { computerNodeKey, sessionNodeKey, type MapLayout } from './layout/types';

/**
 * The agents the Map shows (spec, Agents), as of a moment. The layout puts every session
 * that wrote in the last hour into a cluster, but time passes between layouts, so what
 * is live, quiet, or gone is decided here, against the clock, from the layout's sessions
 * and the rows' episodes. Nothing here has a position; the layout's nodes carry those.
 */

/** Live until 15 minutes without a write, quiet until an hour, then gone from the cluster. */
export type AgentState = 'live' | 'quiet' | 'gone';

export function agentState(lastWriteAt: number, now: number): AgentState {
	const age = now - lastWriteAt;
	return age <= SESSION_QUIET ? 'live' : age <= SESSION_LIVE ? 'quiet' : 'gone';
}

/** One item a session is on. */
export interface AgentItem {
	key: string;
	/** The node that draws it: the item, or the collapsed ancestor that holds it. */
	drawnBy: string;
	branch: string | null;
	/** When the session started on this item, and when it last wrote there; epoch ms. */
	startedAt: number;
	lastWriteAt: number;
}

export interface AgentSession {
	key: string;
	/** The layout node: `session:<key>`. */
	node: string;
	/** 1-based within its computer. */
	number: number;
	device: string;
	client: string | null;
	state: 'live' | 'quiet';
	/** Its newest write across its items. */
	lastWriteAt: number;
	/** In item-key order. */
	items: AgentItem[];
	computer: string;
}

export interface AgentComputer {
	device: string;
	/** The layout node: `computer:<device>`. */
	node: string;
	/** In number order. */
	sessions: AgentSession[];
	/** Any of its sessions is live. */
	live: boolean;
}

export interface Agents {
	/** In device order; only computers with a session still in the cluster. */
	computers: AgentComputer[];
	sessions: AgentSession[];
	byNode: ReadonlyMap<string, AgentSession | AgentComputer>;
}

export const NO_AGENTS: Agents = { computers: [], sessions: [], byNode: new Map() };

/**
 * The sessions in the layout that are still in the cluster at `now`, with the items each
 * is still on: a session leaves an hour after its last write on its item, and a session
 * left with no item is gone, and its computer with it once it has none.
 */
export function agentsOf(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, now: number): Agents {
	const bySession = new Map<string, AgentSession>();
	for (const placed of layout.sessions) {
		const items: AgentItem[] = [];
		for (const key of placed.items) {
			const episode = rows.get(key)?.workers.find((worker) => worker.sessionKey === placed.key);
			const drawnBy = layout.representative[key];
			if (!episode || !drawnBy) continue;
			const lastWriteAt = Date.parse(episode.lastWriteAt);
			if (agentState(lastWriteAt, now) === 'gone') continue;
			items.push({ key, drawnBy, branch: episode.branch, startedAt: Date.parse(episode.startedAt), lastWriteAt });
		}
		if (items.length === 0) continue;
		const lastWriteAt = items.reduce((newest, item) => Math.max(newest, item.lastWriteAt), -Infinity);
		bySession.set(placed.key, {
			key: placed.key,
			node: sessionNodeKey(placed.key),
			number: placed.number,
			device: placed.device,
			client: placed.client,
			state: agentState(lastWriteAt, now) === 'live' ? 'live' : 'quiet',
			lastWriteAt,
			items,
			computer: computerNodeKey(placed.device),
		});
	}
	const computers: AgentComputer[] = [];
	for (const placed of layout.computers) {
		const sessions = placed.sessions.flatMap((key) => bySession.get(key) ?? []);
		if (sessions.length === 0) continue;
		computers.push({ device: placed.device, node: computerNodeKey(placed.device), sessions, live: sessions.some((s) => s.state === 'live') });
	}
	const sessions = computers.flatMap((computer) => computer.sessions);
	const byNode = new Map<string, AgentSession | AgentComputer>();
	for (const computer of computers) byNode.set(computer.node, computer);
	for (const session of sessions) byNode.set(session.node, session);
	return { computers, sessions, byNode };
}

/** What a computer with no device name is called. */
export const deviceLabel = (device: string): string => device || 'Unknown computer';

/** How long, as a person would say it: "under a minute", "12 min", "2 h 5 min", "3 d". */
export function spanText(ms: number): string {
	if (ms < MINUTE) return 'under a minute';
	const minutes = Math.floor(ms / MINUTE);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
	return `${Math.floor(hours / 24)} d`;
}

export const agoText = (ms: number): string => (ms < MINUTE ? 'just now' : `${spanText(ms)} ago`);

/** How the read names a client, which is the MCP client's own identifier ("claude-code"): shown as it is, with a word for none. */
export const clientLabel = (client: string | null): string => client || 'Agent';
