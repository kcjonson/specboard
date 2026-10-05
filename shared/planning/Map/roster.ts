import type { MapItemRow } from '@specboard/core/map-read';
import { agoText, clientLabel, deviceLabel, type Agents } from './agents';

/**
 * The roster behind the summary strip's Agents at work button (spec, Agents): every
 * computer with a session still in the cluster, and under it each session with the items
 * it is on, live sessions first and quiet ones after.
 */

export interface RosterItem {
	key: string;
	title: string;
	row: MapItemRow;
}

export interface RosterSession {
	key: string;
	number: number;
	client: string;
	state: 'live' | 'quiet';
	/** "last write 4 min ago". */
	lastWrite: string;
	items: RosterItem[];
}

export interface RosterGroup {
	device: string;
	label: string;
	live: number;
	sessions: RosterSession[];
}

/** Sessions that are live right now, which the button counts. */
export const liveCount = (working: Agents): number => working.sessions.filter((session) => session.state === 'live').length;

export function rosterOf(working: Agents, rows: ReadonlyMap<string, MapItemRow>, now: number): RosterGroup[] {
	return working.computers.map((computer) => {
		const ordered = [...computer.sessions].sort((a, b) => Number(b.state === 'live') - Number(a.state === 'live') || a.number - b.number);
		return {
			device: computer.device,
			label: deviceLabel(computer.device),
			live: computer.sessions.filter((session) => session.state === 'live').length,
			sessions: ordered.map((session) => ({
				key: session.key,
				number: session.number,
				client: clientLabel(session.client),
				state: session.state,
				lastWrite: `last write ${agoText(now - session.lastWriteAt)}`,
				items: session.items.flatMap((item) => {
					const row = rows.get(item.key);
					return row ? [{ key: item.key, title: row.title, row }] : [];
				}),
			})),
		};
	});
}
