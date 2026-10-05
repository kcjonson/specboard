import type { MapItemRow } from '@specboard/core/map-read';

/** A session is live if it wrote in the last 15 minutes: the threshold the drawer already uses for a quiet worker. */
export const LIVE_SESSION_MS = 15 * 60_000;

/** Whether a session whose last write was at this time (epoch ms) is live at `now`. */
export function isLive(lastWriteAt: number, now: number): boolean {
	return now - lastWriteAt <= LIVE_SESSION_MS;
}

/** The live sessions' opaque keys, and the items they are on, from the open episodes the read carries. */
export function liveSessions(rows: Iterable<MapItemRow>, now: number): { sessions: Set<string>; items: Set<string> } {
	const sessions = new Set<string>();
	const items = new Set<string>();
	for (const row of rows) {
		for (const worker of row.workers) {
			if (!isLive(Date.parse(worker.lastWriteAt), now)) continue;
			sessions.add(worker.sessionKey);
			items.add(row.key);
		}
	}
	return { sessions, items };
}
