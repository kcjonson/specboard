/**
 * API types (camelCase for JSON responses)
 *
 * Item responses are returned directly from the item service (already camelCase),
 * so there's no Api* shape for them here.
 */

import type { SpecType, StorageMode, RepositoryConfig } from '@specboard/db';

export interface ApiSpec {
	id: string;
	itemId: string;
	projectId: string;
	path: string;
	type: SpecType;
	createdAt: string;
}

export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface ApiProject {
	id: string;
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
