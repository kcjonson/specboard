/**
 * Outward views of items and their sub-objects, for every surface that answers a
 * client: REST handlers and MCP tools alike.
 *
 * Actors are stored with internals (userId, OAuth clientId, MCP sessionId) so
 * provenance can trace work server-side. None of that leaves the server: anyone who can
 * read a project, a viewer's agent included, sees only what a UI renders, the actor's
 * type, device name and client software.
 */

import type { Actor, ItemOrigin } from './types.ts';
import type { ItemWithDetails } from './services/items.ts';
import type { ItemNoteSummary } from './services/notes.ts';
import type { BlockerSummary } from './services/blockers.ts';
import type { WorkerSummary } from './services/workers.ts';

export interface ActorView {
	type: Actor['type'];
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

export function actorView(actor: Actor): ActorView {
	return {
		type: actor.type,
		...('deviceName' in actor && actor.deviceName ? { deviceName: actor.deviceName } : {}),
		...('client' in actor && actor.client ? { client: actor.client } : {}),
	};
}

function originView(origin: ItemOrigin | null): ItemOriginView | null {
	if (!origin) return null;
	return {
		actor: actorView(origin.actor),
		...(origin.discoveredFrom ? { discoveredFrom: origin.discoveredFrom } : {}),
	};
}

/** One activity-log entry. */
export function noteView(note: ItemNoteSummary): NoteView {
	return {
		id: note.id,
		note: note.note,
		actor: note.actor ? actorView(note.actor) : null,
		createdAt: note.createdAt,
	};
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

/** One agent-session episode on an item. */
export function workerView(worker: WorkerSummary): WorkerView {
	return {
		id: worker.id,
		branch: worker.branch,
		startedAt: worker.startedAt,
		lastSeenAt: worker.lastSeenAt,
		actor: actorView(worker.actor),
	};
}

/** One item, with every actor it carries reduced to its view. Children carry no actors. */
export function itemView<T extends ItemInput>(item: T): ItemView<T> {
	return {
		...item,
		origin: originView(item.origin),
		...(item.notes ? { notes: item.notes.map(noteView) } : {}),
		...(item.blockers ? { blockers: item.blockers.map(blockerView) } : {}),
		...(item.workers ? { workers: item.workers.map(workerView) } : {}),
	};
}
