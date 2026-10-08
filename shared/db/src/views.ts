/**
 * Outward views of items and their sub-objects, for every surface that answers a
 * client: REST handlers and MCP tools alike.
 *
 * Actors are stored with internals (userId, OAuth clientId, MCP sessionId) so
 * provenance can trace work server-side. None of that leaves the server: anyone who can
 * read a project, a viewer's agent included, sees only what a UI renders, the actor's
 * type, the person they acted as (name, slug, avatar), device name and client software.
 * People are looked up once per response, however many actors it carries.
 */

import type { Actor, ItemOrigin } from './types.ts';
import type { ItemWithDetails } from './services/items.ts';
import type { ItemNoteSummary } from './services/notes.ts';
import type { BlockerSummary } from './services/blockers.ts';
import type { WorkerSummary } from './services/workers.ts';
import { getPeople, type Person } from './services/users.ts';

export interface ActorView {
	type: Actor['type'];
	/**
	 * Who a user or agent actor acted as; null once that account is deleted. Absent on a
	 * system actor, which acts for nobody.
	 */
	person?: Person | null;
	deviceName?: string;
	client?: { name: string; version?: string };
}

export interface ItemOriginView {
	actor: ActorView;
	discoveredFrom?: ItemOrigin['discoveredFrom'];
}

export interface NoteView {
	id: string;
	note: string;
	/** Null for an entry that predates actor capture. */
	actor: ActorView | null;
	createdAt: Date;
}

export type BlockerView = Omit<BlockerSummary, 'createdBy' | 'clearedBy'>;

export interface WorkerView {
	id: string;
	branch: string | null;
	startedAt: Date;
	lastSeenAt: Date;
	actor: ActorView;
}

type ItemInput = Partial<ItemWithDetails> & { origin: ItemOrigin | null };

export type ItemView<T extends ItemInput> = Omit<T, 'origin' | 'notes' | 'blockers' | 'workers'> & {
	origin: ItemOriginView | null;
	notes?: NoteView[];
	blockers?: BlockerView[];
	workers?: WorkerView[];
};

type People = ReadonlyMap<string, Person>;

function actorUserId(actor: Actor | null | undefined): string | undefined {
	return actor && actor.type !== 'system' ? actor.userId : undefined;
}

function actorView(actor: Actor, people: People): ActorView {
	return {
		type: actor.type,
		...(actor.type !== 'system' ? { person: people.get(actor.userId) ?? null } : {}),
		...('deviceName' in actor && actor.deviceName ? { deviceName: actor.deviceName } : {}),
		...('client' in actor && actor.client ? { client: actor.client } : {}),
	};
}

function originView(origin: ItemOrigin | null, people: People): ItemOriginView | null {
	if (!origin) return null;
	return {
		actor: actorView(origin.actor, people),
		...(origin.discoveredFrom ? { discoveredFrom: origin.discoveredFrom } : {}),
	};
}

function toNoteView(note: ItemNoteSummary, people: People): NoteView {
	return {
		id: note.id,
		note: note.note,
		actor: note.actor ? actorView(note.actor, people) : null,
		createdAt: note.createdAt,
	};
}

function toWorkerView(worker: WorkerSummary, people: People): WorkerView {
	return {
		id: worker.id,
		branch: worker.branch,
		startedAt: worker.startedAt,
		lastSeenAt: worker.lastSeenAt,
		actor: actorView(worker.actor, people),
	};
}

/** Activity-log entries, newest first as given. */
export async function noteViews(notes: ItemNoteSummary[]): Promise<NoteView[]> {
	const people = await getPeople(notes.map((note) => actorUserId(note.actor)).filter((id) => id !== undefined));
	return notes.map((note) => toNoteView(note, people));
}

/** One activity-log entry. */
export async function noteView(note: ItemNoteSummary): Promise<NoteView> {
	return (await noteViews([note]))[0]!;
}

/** One blocker, without who set or cleared it. */
export function blockerView(blocker: BlockerSummary): BlockerView {
	return {
		id: blocker.id,
		type: blocker.type,
		text: blocker.text,
		blockerKey: blocker.blockerKey,
		blockerTitle: blocker.blockerTitle,
		blockerStatus: blocker.blockerStatus,
		createdAt: blocker.createdAt,
		clearedAt: blocker.clearedAt,
	};
}

/** Items, with every actor they carry reduced to its view. Children carry no actors. */
export async function itemViews<T extends ItemInput>(items: T[]): Promise<ItemView<T>[]> {
	const ids: string[] = [];
	const add = (actor: Actor | null | undefined): void => {
		const id = actorUserId(actor);
		if (id) ids.push(id);
	};
	for (const item of items) {
		add(item.origin?.actor);
		for (const note of item.notes ?? []) add(note.actor);
		for (const worker of item.workers ?? []) add(worker.actor);
	}
	const people = await getPeople(ids);

	return items.map((item) => ({
		...item,
		origin: originView(item.origin, people),
		...(item.notes ? { notes: item.notes.map((note) => toNoteView(note, people)) } : {}),
		...(item.blockers ? { blockers: item.blockers.map(blockerView) } : {}),
		...(item.workers ? { workers: item.workers.map((worker) => toWorkerView(worker, people)) } : {}),
	}));
}

/** One item, as itemViews reduces it. */
export async function itemView<T extends ItemInput>(item: T): Promise<ItemView<T>> {
	return (await itemViews([item]))[0]!;
}
