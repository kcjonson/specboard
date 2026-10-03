/**
 * A generated project shaped like a real board, for measuring the Map read: epics
 * nested a few levels deep, most history finished (much of it before 033 stamped
 * completions), activity-log entries, transitions, item and text blockers in every
 * state, open and ended agent episodes, spec links, and agent-filed work with
 * discovered-from lineage. Deterministic for a given seed. Bulk inserts through
 * unnest, so it runs the same against PGlite and a real Postgres.
 */

type Sql = (text: string, params?: unknown[]) => Promise<unknown>;

const DAY = 86_400_000;

const WORDS = (
	'map read layout region blocker anchor session worker drawer board table filter search rank status '
	+ 'review agent spec epic task bug login signup email token cache poll refresh render canvas label '
	+ 'checklist activity log rollup parent child migration index query payload export import theme dark '
	+ 'light toolbar shortcut focus keyboard summary strip deploy staging release webhook sync github'
).split(' ');

/** Mulberry32: small, fast, and good enough to make a board look unplanned. */
function generator(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface MapFixtureOptions {
	projectId: string;
	userId: string;
	items: number;
	now: number;
	seed?: number;
}

export interface MapFixtureSecrets {
	/** Every user, client, and session id the fixture wrote into an actor. */
	identifiers: string[];
}

export async function generateMapProject(sql: Sql, options: MapFixtureOptions): Promise<MapFixtureSecrets> {
	const { projectId, userId, now } = options;
	const random = generator(options.seed ?? 7);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const uuid = (): string => {
		const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
	};
	const title = (): string => {
		const words = Array.from({ length: 4 + Math.floor(random() * 7) }, () => pick(WORDS));
		return words.join(' ').replace(/^./, (c) => c.toUpperCase());
	};

	const devices = ['personal-laptop', 'work-desktop'];
	const sessions = Array.from({ length: 6 }, (_, i) => ({
		type: 'agent',
		userId,
		clientId: `client-${i % 2}-${uuid()}`,
		sessionId: `session-${uuid()}`,
		deviceName: devices[i % 2],
		client: { name: 'claude-code', version: '2.1.0' },
	}));
	const user = { type: 'user', userId };
	const start = now - 120 * DAY;
	const stampsSince = now - 40 * DAY;

	interface Generated {
		id: string;
		number: number;
		parent: number | null;
		type: string;
		status: string;
		created: number;
		started: number | null;
		completed: number | null;
		finished: number | null;
	}

	const items: Generated[] = [];
	const containers: number[] = [];
	const columns = {
		id: [] as string[], number: [] as number[], parent: [] as (string | null)[], type: [] as string[],
		title: [] as string[], status: [] as string[], subStatus: [] as string[], rank: [] as number[],
		prUrl: [] as (string | null)[], origin: [] as string[], created: [] as string[],
		started: [] as (string | null)[], completed: [] as (string | null)[],
	};

	for (let number = 1; number <= options.items; number++) {
		const age = number / options.items;
		const created = start + age * 115 * DAY + random() * DAY;
		let parent: number | null = null;
		let type: string;
		if (number <= Math.max(3, Math.ceil(options.items * 0.015))) {
			type = 'epic';
		} else {
			const roll = random();
			const recent = containers.slice(-12);
			if (roll < 0.07) type = random() < 0.7 ? 'task' : 'bug';
			else if (roll < 0.13) {
				type = 'epic';
				if (random() < 0.6) parent = pick(recent);
			} else {
				type = random() < 0.85 ? 'task' : 'bug';
				parent = pick(random() < 0.8 ? recent : containers);
			}
		}
		if (type === 'epic') containers.push(number);

		const roll = random();
		const status = age < 0.75
			? (roll < 0.93 ? 'done' : roll < 0.98 ? 'ready' : 'blocked')
			: (roll < 0.4 ? 'done' : roll < 0.5 ? 'in_progress' : roll < 0.55 ? 'in_review' : roll < 0.93 ? 'ready' : 'blocked');
		const finished = status === 'done' ? Math.min(now - 60_000, created + random() * 12 * DAY) : null;
		const stamped = (finished ?? now) > stampsSince;
		const began = status === 'ready' ? null : created + random() * 2 * DAY;
		const started = began !== null && stamped && status !== 'blocked' ? Math.min(began, now - 120_000) : null;
		const completed = finished !== null && finished > stampsSince ? finished : null;
		const subStatus = status === 'done' ? 'complete'
			: status === 'in_review' ? 'pr_open'
			: status === 'in_progress' ? pick(['in_development', 'in_development', 'needs_input', 'pr_open'])
			: 'not_started';
		const id = uuid();
		items.push({ id, number, parent, type, status, created, started, completed, finished });

		const agentMade = random() < 0.6;
		const origin: Record<string, unknown> = { actor: agentMade ? pick(sessions) : user };
		if (agentMade && number > 10 && random() < 0.15) {
			const source = items[Math.floor(random() * (number - 1))]!;
			origin.discoveredFrom = { itemId: source.id, itemKey: `MAP-${source.number}` };
		}

		columns.id.push(id);
		columns.number.push(number);
		columns.parent.push(parent === null ? null : items[parent - 1]!.id);
		columns.type.push(type);
		columns.title.push(title());
		columns.status.push(status);
		columns.subStatus.push(subStatus);
		columns.rank.push(number);
		columns.prUrl.push(status === 'in_review' || (status === 'done' && random() < 0.35)
			? `https://github.com/acme/roadmap/pull/${100 + Math.floor(random() * 900)}` : null);
		columns.origin.push(JSON.stringify(origin));
		columns.created.push(new Date(created).toISOString());
		columns.started.push(started === null ? null : new Date(started).toISOString());
		columns.completed.push(completed === null ? null : new Date(completed).toISOString());
	}

	// Rows that finished before 033 have no completed_at, and the trigger would stamp one
	// on insert, so it stands aside while history is written.
	await sql('ALTER TABLE items DISABLE TRIGGER items_status_stamps');
	await sql(
		`INSERT INTO items (id, project_id, number, parent_id, type, title, status, sub_status, rank, pr_url, origin,
			created_at, updated_at, started_at, completed_at)
		 SELECT u.id, $1, u.number, u.parent, u.type, u.title, u.status, u.sub_status, u.rank, u.pr_url, u.origin::jsonb,
			u.created, u.created, u.started, u.completed
		 FROM unnest($2::uuid[], $3::int[], $4::uuid[], $5::text[], $6::text[], $7::text[], $8::text[], $9::float8[],
			$10::text[], $11::text[], $12::timestamptz[], $13::timestamptz[], $14::timestamptz[])
			AS u(id, number, parent, type, title, status, sub_status, rank, pr_url, origin, created, started, completed)`,
		[projectId, columns.id, columns.number, columns.parent, columns.type, columns.title, columns.status,
			columns.subStatus, columns.rank, columns.prUrl, columns.origin, columns.created, columns.started, columns.completed]
	);
	await sql('ALTER TABLE items ENABLE TRIGGER items_status_stamps');
	await sql('UPDATE projects SET item_seq = $2 WHERE id = $1', [projectId, options.items]);

	const at = (time: number): string => new Date(Math.min(time, now - 1000)).toISOString();
	const activeUntil = (item: Generated): number => item.finished ?? Math.min(now, item.created + 30 * DAY);

	const notes = { item: [] as string[], note: [] as string[], actor: [] as string[], created: [] as string[] };
	const transitions = {
		item: [] as string[], from: [] as (string | null)[], to: [] as string[], fromSub: [] as (string | null)[],
		toSub: [] as string[], actor: [] as string[], created: [] as string[],
	};
	const blockers = {
		item: [] as string[], blocker: [] as (string | null)[], text: [] as (string | null)[], createdBy: [] as string[],
		created: [] as string[], cleared: [] as (string | null)[], clearedBy: [] as (string | null)[],
	};
	const workers = {
		item: [] as string[], actor: [] as string[], branch: [] as string[], started: [] as string[],
		lastSeen: [] as string[], ended: [] as (string | null)[],
	};
	const specs = { item: [] as string[], path: [] as string[] };

	for (const item of items) {
		const span = activeUntil(item) - item.created;
		const noteCount = Math.floor(random() * 7);
		for (let i = 0; i < noteCount; i++) {
			notes.item.push(item.id);
			notes.note.push(`${title()}. ${title()}.`);
			notes.actor.push(JSON.stringify(random() < 0.7 ? pick(sessions) : user));
			notes.created.push(at(item.created + random() * span));
		}

		if (item.started !== null) {
			transitions.item.push(item.id);
			transitions.from.push('ready');
			transitions.to.push('in_progress');
			transitions.fromSub.push('not_started');
			transitions.toSub.push('in_development');
			transitions.actor.push(JSON.stringify(pick(sessions)));
			transitions.created.push(at(item.started));
		}
		if (item.completed !== null) {
			transitions.item.push(item.id);
			transitions.from.push(item.started !== null ? 'in_progress' : 'ready');
			transitions.to.push('done');
			transitions.fromSub.push(item.started !== null ? 'in_development' : 'not_started');
			transitions.toSub.push('complete');
			transitions.actor.push(JSON.stringify(pick(sessions)));
			transitions.created.push(at(item.completed));
		}

		if (item.number > 5 && random() < 0.12) {
			const linkCount = 1 + Math.floor(random() * 2);
			const used = new Set<number>();
			for (let i = 0; i < linkCount; i++) {
				const blocker = items[Math.max(0, item.number - 2 - Math.floor(random() * 40))]!;
				if (used.has(blocker.number)) continue;
				used.add(blocker.number);
				const added = item.created + random() * DAY;
				blockers.item.push(item.id);
				blockers.blocker.push(blocker.id);
				blockers.text.push(null);
				blockers.createdBy.push(JSON.stringify(random() < 0.7 ? pick(sessions) : user));
				blockers.created.push(at(added));
				if (random() < 0.1) {
					blockers.cleared.push(at(added + random() * 3 * DAY));
					blockers.clearedBy.push(JSON.stringify(user));
				} else if (blocker.finished !== null) {
					blockers.cleared.push(at(Math.max(added, blocker.finished)));
					blockers.clearedBy.push('{"type":"system","cause":"blocking_item_done"}');
				} else if (item.finished !== null) {
					blockers.cleared.push(at(item.finished));
					blockers.clearedBy.push('{"type":"system","cause":"item_completed"}');
				} else {
					blockers.cleared.push(null);
					blockers.clearedBy.push(null);
				}
			}
		}
		if (random() < 0.03) {
			blockers.item.push(item.id);
			blockers.blocker.push(null);
			blockers.text.push(`Waiting on ${title().toLowerCase()}`);
			blockers.createdBy.push(JSON.stringify(user));
			blockers.created.push(at(item.created + random() * DAY));
			const removed = item.finished !== null || random() < 0.3;
			blockers.cleared.push(removed ? at(item.created + DAY + random() * DAY) : null);
			blockers.clearedBy.push(removed ? JSON.stringify(user) : null);
		}

		if (item.status === 'in_progress' && random() < 0.4) {
			const session = pick(sessions);
			const lastSeen = now - random() * 3 * 3_600_000;
			workers.item.push(item.id);
			workers.actor.push(JSON.stringify(session));
			workers.branch.push(`feat/MAP-${item.number}-${pick(WORDS)}`);
			workers.started.push(at(lastSeen - random() * 3_600_000));
			workers.lastSeen.push(at(lastSeen));
			workers.ended.push(null);
		}
		if (item.started !== null && random() < 0.5) {
			const ended = item.finished ?? item.started + DAY;
			workers.item.push(item.id);
			workers.actor.push(JSON.stringify(pick(sessions)));
			workers.branch.push(`feat/MAP-${item.number}-${pick(WORDS)}`);
			workers.started.push(at(item.started));
			workers.lastSeen.push(at(ended - 60_000));
			workers.ended.push(at(ended));
		}

		const specCount = random() < 0.08 ? 1 : random() < 0.02 ? 2 : 0;
		for (let i = 0; i < specCount; i++) {
			specs.item.push(item.id);
			specs.path.push(`/docs/specs/${pick(WORDS)}-${pick(WORDS)}-${item.number}-${i}.md`);
		}
	}

	await sql(
		`INSERT INTO item_notes (item_id, note, actor, created_at)
		 SELECT * FROM unnest($1::uuid[], $2::text[], $3::jsonb[], $4::timestamptz[])`,
		[notes.item, notes.note, notes.actor, notes.created]
	);
	await sql(
		`INSERT INTO item_transitions (item_id, project_id, from_status, to_status, from_sub_status, to_sub_status, actor, created_at)
		 SELECT u.item, $1, u.f, u.t, u.fs, u.ts, u.actor, u.created
		 FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[], $8::timestamptz[])
			AS u(item, f, t, fs, ts, actor, created)`,
		[projectId, transitions.item, transitions.from, transitions.to, transitions.fromSub, transitions.toSub,
			transitions.actor, transitions.created]
	);
	await sql(
		`INSERT INTO item_blockers (item_id, project_id, blocker_item_id, blocker_text, created_by, created_at, cleared_at, cleared_by)
		 SELECT u.item, $1, u.blocker, u.text, u.created_by, u.created, u.cleared, u.cleared_by
		 FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::jsonb[], $6::timestamptz[], $7::timestamptz[], $8::jsonb[])
			AS u(item, blocker, text, created_by, created, cleared, cleared_by)`,
		[projectId, blockers.item, blockers.blocker, blockers.text, blockers.createdBy, blockers.created,
			blockers.cleared, blockers.clearedBy]
	);
	await sql(
		`INSERT INTO item_workers (item_id, project_id, actor, branch, started_at, last_seen_at, ended_at)
		 SELECT u.item, $1, u.actor, u.branch, u.started, u.last_seen, u.ended
		 FROM unnest($2::uuid[], $3::jsonb[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::timestamptz[])
			AS u(item, actor, branch, started, last_seen, ended)`,
		[projectId, workers.item, workers.actor, workers.branch, workers.started, workers.lastSeen, workers.ended]
	);
	await sql(
		`INSERT INTO epic_specs (item_id, project_id, path, spec_type)
		 SELECT u.item, $1, u.path, 'technical' FROM unnest($2::uuid[], $3::text[]) AS u(item, path)`,
		[projectId, specs.item, specs.path]
	);

	return { identifiers: [userId, ...sessions.flatMap((s) => [s.clientId, s.sessionId])] };
}
