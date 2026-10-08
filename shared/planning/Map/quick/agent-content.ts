import type { MapItemRow } from '@specboard/core/map-read';
import { computerName } from '../layout/types';
import { agentState, agoText, clientLabel, deviceLabel, spanText, type AgentComputer, type AgentSession, type Agents } from '../agents';

/**
 * What the hover card says about agents (spec, Agents): for a session, a computer, or an
 * item, the details that tell a stalled session from a slow one: client, device, branch,
 * how long it has been on the item, and how long since its last write. Strings are made
 * here against a clock so the card's height follows from them before it renders.
 */

/** The second line of a block on a card: a lead that gives way with an ellipsis when the card is narrow (a branch, a list of items), and a tail that never does (the times). */
export interface QuickMeta {
	lead: string | null;
	tail: string;
}

/** One session on an item's card: a line naming the agent and one with what it has been doing. */
export interface QuickSession {
	title: string;
	meta: QuickMeta;
	/** No write for 15 minutes, or gone from the cluster after an hour. */
	quiet: boolean;
}

/** Every open episode on the item, newest write first, numbered as the Map numbers its sessions. */
export function itemSessions(row: MapItemRow, working: Agents, now: number): QuickSession[] {
	const numbers = new Map(working.sessions.map((session) => [session.key, session.number]));
	return [...row.workers]
		.sort((a, b) => Date.parse(b.lastWriteAt) - Date.parse(a.lastWriteAt) || (a.sessionKey < b.sessionKey ? -1 : 1))
		.map((worker) => {
			const last = Date.parse(worker.lastWriteAt);
			const number = numbers.get(worker.sessionKey);
			const state = agentState(last, now);
			const place = `${clientLabel(worker.client)} on ${deviceLabel(computerName(worker.personName, worker.deviceName))}`;
			const times = `${spanText(now - Date.parse(worker.startedAt))} on item, last write ${agoText(now - last)}`;
			return {
				title: `${number === undefined ? '' : `Session ${number}, `}${place}${state === 'live' ? '' : ', quiet'}`,
				meta: { lead: worker.branch, tail: times },
				quiet: state !== 'live',
			};
		});
}

/** One row of an agent card: a key, a title, and what it adds. */
export interface AgentCardRow {
	key: string;
	title: string;
	meta: QuickMeta;
}

export interface AgentCard {
	kind: 'session' | 'computer';
	/** The head line: what this is, and when it last wrote. */
	kicker: string;
	title: string;
	chips: string[];
	rows: AgentCardRow[];
	/** Rows past the ones named. */
	more: number;
}

/** A card names this many rows and counts the rest. */
export const AGENT_CARD_ROWS = 4;

function sessionCard(session: AgentSession, rows: ReadonlyMap<string, MapItemRow>, now: number): AgentCard {
	const items = session.items.map((item) => ({
		key: item.key,
		title: rows.get(item.key)?.title ?? '',
		meta: { lead: item.branch, tail: `${spanText(now - item.startedAt)} on item, last write ${agoText(now - item.lastWriteAt)}` },
	}));
	return {
		kind: 'session',
		kicker: `Agent session · last write ${agoText(now - session.lastWriteAt)}`,
		title: `Session ${session.number} on ${deviceLabel(session.device)}`,
		chips: [clientLabel(session.client), session.state === 'live' ? 'Live' : 'Quiet'],
		rows: items.slice(0, AGENT_CARD_ROWS),
		more: Math.max(0, items.length - AGENT_CARD_ROWS),
	};
}

function computerCard(computer: AgentComputer, now: number): AgentCard {
	const sessions = computer.sessions.map((session) => ({
		key: `Session ${session.number}`,
		title: clientLabel(session.client),
		meta: { lead: session.items.map((item) => item.key).join(', '), tail: `last write ${agoText(now - session.lastWriteAt)}${session.state === 'live' ? '' : ', quiet'}` },
	}));
	const live = computer.sessions.filter((session) => session.state === 'live').length;
	const newest = computer.sessions.reduce((latest, session) => Math.max(latest, session.lastWriteAt), -Infinity);
	return {
		kind: 'computer',
		kicker: `Computer · last write ${agoText(now - newest)}`,
		title: deviceLabel(computer.device),
		chips: [computer.sessions.length === 1 ? '1 session' : `${computer.sessions.length} sessions`, live === 0 ? 'None live' : `${live} live`],
		rows: sessions.slice(0, AGENT_CARD_ROWS),
		more: Math.max(0, sessions.length - AGENT_CARD_ROWS),
	};
}

/** The card for a computer or session node; null when it has left the cluster. */
export function agentCard(node: string, working: Agents, rows: ReadonlyMap<string, MapItemRow>, now: number): AgentCard | null {
	const agent = working.byNode.get(node);
	if (!agent) return null;
	return 'sessions' in agent ? computerCard(agent, now) : sessionCard(agent, rows, now);
}

const PAD = 12;
const GAP = 6;
const HEAD = 18;
const TITLE = 36;
const CHIPS = 20;
const ROW = 32;
const MORE = 16;

/** The card's height: the fixed parts, a block per row (a key and title line, and a line under it), and a line for the rest. */
export function agentCardHeight(card: AgentCard): number {
	const parts = [HEAD, TITLE, CHIPS, ...Array<number>(card.rows.length).fill(ROW), ...(card.more > 0 ? [MORE] : [])];
	return 2 * PAD + parts.reduce((sum, part) => sum + part, 0) + GAP * (parts.length - 1);
}
