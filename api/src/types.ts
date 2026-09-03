/**
 * API types (camelCase for JSON responses)
 *
 * Item responses are returned directly from the item service (already camelCase),
 * so there's no Api* shape for them here.
 */

import type { SpecType, StorageMode, RepositoryConfig, BlockerSummary, WorkerSummary, Actor, ItemOrigin, ItemWithDetails } from '@specboard/db';

export interface ApiSpec {
	id: string;
	/** Key of the item this spec is linked to (e.g. SB-345). */
	itemKey: string;
	/** Slug of the project the item belongs to. */
	projectSlug: string;
	path: string;
	type: SpecType;
	createdAt: string;
}

/**
 * Browser-facing shapes for item sub-objects. Actor internals (userId, OAuth
 * clientId, live MCP sessionId) stay server-side; the UI only needs what it
 * renders.
 */
function apiActorView(actor: Actor): Record<string, unknown> {
	return {
		type: actor.type,
		...('deviceName' in actor && actor.deviceName ? { deviceName: actor.deviceName } : {}),
		...('client' in actor && actor.client ? { client: actor.client } : {}),
	};
}

function apiOrigin(origin: ItemOrigin | null): Record<string, unknown> | null {
	if (!origin) return null;
	return {
		actor: apiActorView(origin.actor),
		...(origin.discoveredFrom ? { discoveredFrom: origin.discoveredFrom } : {}),
	};
}

/** One item response with actor internals stripped, for every browser-facing handler. */
export function apiItem<T extends Partial<ItemWithDetails> & { origin: ItemOrigin | null }>(item: T): Record<string, unknown> {
	return {
		...item,
		origin: apiOrigin(item.origin),
		...(item.blockers ? { blockers: item.blockers.map(apiBlocker) } : {}),
		...(item.workers ? { workers: item.workers.map(apiWorker) } : {}),
	};
}

export function apiBlocker(blocker: BlockerSummary): Record<string, unknown> {
	return {
		id: blocker.id,
		type: blocker.type,
		text: blocker.text,
		blockerKey: blocker.blockerKey,
		blockerTitle: blocker.blockerTitle,
		blockerStatus: blocker.blockerStatus,
		createdAt: blocker.createdAt.toISOString(),
		clearedAt: blocker.clearedAt ? blocker.clearedAt.toISOString() : null,
	};
}

export function apiWorker(worker: WorkerSummary): Record<string, unknown> {
	return {
		id: worker.id,
		branch: worker.branch,
		startedAt: worker.startedAt.toISOString(),
		lastSeenAt: worker.lastSeenAt.toISOString(),
		actor: {
			type: worker.actor.type,
			...(worker.actor.deviceName ? { deviceName: worker.actor.deviceName } : {}),
			...(worker.actor.client ? { client: worker.actor.client } : {}),
		},
	};
}

export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface ApiProject {
	id: string;
	/** URL identifier for this project (e.g. "specboard"). */
	slug: string;
	/** Short uppercase prefix for this project's item keys (e.g. "SB"). */
	key: string;
	name: string;
	description?: string;
	ownerId: string;
	storageMode: StorageMode;
	repository: RepositoryConfig | Record<string, never>;
	rootPaths: string[];
	systemPrompt?: string;
	syncStatus: SyncStatus | null;
	syncError: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ApiProjectWithStats extends ApiProject {
	itemCount: number;
}
