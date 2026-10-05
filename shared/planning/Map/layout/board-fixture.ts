import type { MapBlockerLink, MapItemRow, MapWorkerEpisode } from '@specboard/core/map-read';

/**
 * Synthesized boards for the layout tests, shaped like a real one but with no real
 * item text. Everything is derived from a seed, so a board is the same on every run.
 */

export const NOW = Date.parse('2026-09-30T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const iso = (time: number): string => new Date(time).toISOString();

/** mulberry32: a small seeded generator for building boards, not for the layout. */
export function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

type ItemSpec = Partial<Omit<MapItemRow, 'key' | 'rank'>> & Pick<MapItemRow, 'status'> & { created?: number; started?: number; completed?: number };

export class BoardBuilder {
	readonly rows: MapItemRow[] = [];
	private nextNumber = 1;
	private readonly ranks = new Map<string | null, number>();

	readonly now: number;

	constructor(now = NOW) {
		this.now = now;
	}

	add(spec: ItemSpec): MapItemRow {
		const { created, started, completed, ...fields } = spec;
		const parentKey = fields.parentKey ?? null;
		const rank = (this.ranks.get(parentKey) ?? 0) + 1;
		this.ranks.set(parentKey, rank);
		const createdAt = created ?? this.now - 30 * DAY;
		const startedAt = started ?? (spec.status === 'in_progress' || spec.status === 'in_review' ? this.now - 2 * HOUR : undefined);
		const completedAt = spec.status === 'done' ? (completed ?? this.now - DAY) : undefined;
		const anchor = completedAt ?? Math.max(createdAt, startedAt ?? -Infinity);
		const row: MapItemRow = {
			key: `MAP-${this.nextNumber++}`,
			type: 'task',
			title: `Item ${this.nextNumber - 1}`,
			subStatus: null,
			blocked: false,
			parentKey,
			rank,
			createdAt: iso(createdAt),
			startedAt: startedAt === undefined ? null : iso(startedAt),
			completedAt: completedAt === undefined ? null : iso(completedAt),
			timeAnchor: iso(anchor),
			workers: [],
			blockers: [],
			textBlockerCount: 0,
			discoveredFromKey: null,
			originActorType: 'agent',
			prUrl: null,
			specCount: 0,
			...fields,
		};
		this.rows.push(row);
		return row;
	}

	block(blocked: MapItemRow, blocker: MapItemRow, state: MapBlockerLink['state'] = blocker.status === 'done' ? 'satisfied' : 'open'): void {
		blocked.blockers.push(state === 'open'
			? { blockerKey: blocker.key, state }
			: { blockerKey: blocker.key, state, satisfiedAt: blocker.completedAt ?? iso(this.now) });
		if (state === 'open') blocked.blocked = true;
	}

	/** An episode of a session on an item: it began `onMinutes` ago (an hour and a half by default) and last wrote `minutesAgo` ago. */
	work(item: MapItemRow, sessionKey: string, deviceName: string, minutesAgo = 5, onMinutes = 90, client = 'claude-code'): void {
		const episode: MapWorkerEpisode = {
			sessionKey,
			deviceName,
			client,
			branch: `feat/${item.key}`,
			startedAt: iso(this.now - Math.max(onMinutes, minutesAgo) * 60_000),
			lastWriteAt: iso(this.now - minutesAgo * 60_000),
		};
		item.workers.push(episode);
		item.timeAnchor = episode.lastWriteAt;
	}
}

export interface RealisticBoard {
	rows: MapItemRow[];
	/** An in-progress epic holding two blocked chains and a finished one. */
	epic: MapItemRow;
	openChains: [MapItemRow[], MapItemRow[]];
	finishedChain: MapItemRow[];
	/** An epic with a sub-epic. */
	nested: MapItemRow;
	/** A finished epic of a hundred done children, collapsed by default. */
	finished: MapItemRow;
	/** Ready items a local-pass test can pick up. */
	pickups: MapItemRow[];
	/** Twelve loose items closed in one sitting, four minutes apart. */
	burst: MapItemRow[];
}

/**
 * About 200 items: a few big epics including a nested one and a 100-child finished
 * one, mostly loose items, a burst of completions, two blocked chains in one epic and
 * one finished chain, three live sessions on two computers.
 */
export function realisticBoard(): RealisticBoard {
	const random = seeded(227);
	const b = new BoardBuilder();
	const ago = (days: number): number => b.now - days * DAY;
	const between = (from: number, to: number): number => from + (to - from) * random();

	const epic = b.add({ type: 'epic', status: 'in_progress', created: ago(24), started: ago(20) });
	const under = { parentKey: epic.key };
	for (let i = 0; i < 12; i++) b.add({ ...under, status: 'done', created: ago(22), completed: ago(19 - i * 1.4) });
	const finishedChain = [0, 1, 2].map((i) => b.add({ ...under, status: 'done', created: ago(12), completed: ago(6 - i) }));
	b.block(finishedChain[1]!, finishedChain[0]!);
	b.block(finishedChain[2]!, finishedChain[1]!);
	const first = [b.add({ ...under, status: 'in_progress', created: ago(5), started: ago(1) })];
	for (let i = 0; i < 3; i++) first.push(b.add({ ...under, status: 'ready', created: ago(5) }));
	for (let i = 1; i < first.length; i++) b.block(first[i]!, first[i - 1]!);
	const second = [b.add({ ...under, status: 'ready', created: ago(4) })];
	for (let i = 0; i < 2; i++) second.push(b.add({ ...under, status: 'ready', created: ago(4) }));
	for (let i = 1; i < second.length; i++) b.block(second[i]!, second[i - 1]!);
	const epicWork = b.add({ ...under, status: 'in_progress', created: ago(3), started: ago(0.5) });
	b.add({ ...under, status: 'in_review', created: ago(6), started: ago(2), subStatus: 'pr_open' });
	for (let i = 0; i < 4; i++) b.add({ ...under, status: 'ready', created: ago(8 - i) });

	const nested = b.add({ type: 'epic', status: 'in_progress', created: ago(15), started: ago(9) });
	const inNested = { parentKey: nested.key };
	b.add({ ...inNested, status: 'done', created: ago(14), completed: ago(8) });
	b.add({ ...inNested, status: 'done', created: ago(14), completed: ago(7) });
	b.add({ ...inNested, status: 'in_progress', created: ago(10), started: ago(1.5) });
	for (let i = 0; i < 3; i++) b.add({ ...inNested, status: 'ready', created: ago(12 - i) });
	const sub = b.add({ ...inNested, type: 'epic', status: 'in_progress', created: ago(11), started: ago(6) });
	const inSub = { parentKey: sub.key };
	for (let i = 0; i < 3; i++) b.add({ ...inSub, status: 'done', created: ago(10), completed: ago(5 - i) });
	const subWork = b.add({ ...inSub, status: 'in_progress', created: ago(4), started: ago(0.3) });
	for (let i = 0; i < 2; i++) b.add({ ...inSub, status: 'ready', created: ago(9) });

	const finished = b.add({ type: 'epic', status: 'done', created: ago(55), completed: ago(25) });
	for (let i = 0; i < 100; i++) {
		b.add({ parentKey: finished.key, status: 'done', created: between(ago(55), ago(45)), completed: ago(40 - i * 0.15) });
	}

	const burstAt = ago(2);
	const burst = Array.from({ length: 12 }, (_, i) => b.add({ type: 'bug', status: 'done', created: ago(3), completed: burstAt + i * 4 * 60_000 }));
	for (let i = 0; i < 15; i++) b.add({ status: 'done', created: ago(60), completed: between(ago(58), ago(9)) });
	const looseWork = b.add({ status: 'in_progress', created: ago(2), started: ago(0.2) });
	b.add({ status: 'in_progress', created: ago(7), started: ago(4) });
	b.add({ status: 'blocked', created: ago(9), started: ago(5), subStatus: 'paused', blocked: true });
	const ready: MapItemRow[] = [];
	for (let i = 0; i < 22; i++) ready.push(b.add({ type: i % 5 === 0 ? 'bug' : 'task', status: 'ready', created: between(ago(45), ago(0.5)) }));
	b.block(ready[3]!, ready[2]!);
	b.block(ready[4]!, looseWork);
	b.block(ready[5]!, first[0]!);
	ready[6]!.blocked = true;
	ready[6]!.textBlockerCount = 1;
	for (let i = 7; i < 12; i++) ready[i]!.discoveredFromKey = b.rows[1 + i]!.key;
	b.add({ status: 'blocked', created: ago(20), blocked: true });

	b.work(first[0]!, 'session-a', 'personal-laptop', 3);
	b.work(epicWork, 'session-a', 'personal-laptop', 3);
	b.work(looseWork, 'session-b', 'personal-laptop', 9);
	b.work(subWork, 'session-c', 'build-box', 1);

	return {
		rows: b.rows,
		epic,
		openChains: [first, second],
		finishedChain,
		nested,
		finished,
		pickups: [ready[13]!, ready[16]!, ready[19]!],
		burst,
	};
}

/**
 * A larger board for timing: epics of mixed sizes (about half finished, so they fold
 * by default), mostly loose work, blockers, and sessions.
 */
export function syntheticBoard(count: number, seed = 1): MapItemRow[] {
	const random = seeded(seed);
	const b = new BoardBuilder();
	const ago = (days: number): number => b.now - days * DAY;
	const span = 120;
	const status = (): MapItemRow['status'] => {
		const r = random();
		return r < 0.55 ? 'done' : r < 0.62 ? 'in_progress' : r < 0.65 ? 'in_review' : r < 0.7 ? 'blocked' : 'ready';
	};
	const item = (parentKey: string | null, s = status()): MapItemRow => {
		const created = ago(span * random());
		return b.add({
			parentKey,
			status: s,
			created,
			started: s === 'in_progress' || s === 'in_review' ? Math.max(created, ago(3 * random())) : undefined,
			completed: s === 'done' ? created + (b.now - created) * random() : undefined,
			blocked: s === 'blocked',
		});
	};
	const all: MapItemRow[] = [];
	while (b.rows.length < count) {
		if (random() < 0.08) {
			// Roughly half of a real board's epics are finished, and fold to one dot.
			const finished = random() < 0.5;
			const epic = b.add({ type: 'epic', status: finished ? 'done' : 'in_progress', created: ago(span * random()) });
			all.push(epic);
			const size = Math.min(count - b.rows.length, 3 + Math.floor(random() * random() * 60));
			const children = Array.from({ length: size }, () => item(epic.key, finished ? 'done' : status()));
			all.push(...children);
			if (finished && children.length) {
				const closed = Math.max(...children.map((child) => Date.parse(child.completedAt!)));
				epic.completedAt = iso(closed);
				epic.timeAnchor = iso(closed);
			}
		} else {
			all.push(item(null));
		}
	}
	for (let i = 0; i < count / 12; i++) {
		const blocked = all[Math.floor(random() * all.length)]!;
		const blocker = all[Math.floor(random() * all.length)]!;
		if (blocked !== blocker) b.block(blocked, blocker);
	}
	const working = all.filter((row) => row.status === 'in_progress').slice(0, 8);
	working.forEach((row, i) => b.work(row, `session-${i % 5}`, `computer-${i % 2}`, 2 + i));
	return b.rows;
}
