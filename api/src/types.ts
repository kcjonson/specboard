/**
 * API types (camelCase for JSON responses)
 *
 * Item responses come from the item service (already camelCase) through itemView
 * (@specboard/db), the one place actor internals are stripped for REST and MCP alike.
 */

import type { SpecType, StorageMode, RepositoryConfig, ProjectRole } from '@specboard/db';

export interface ApiSpec {
	id: string;
	/** Key of the item this spec is linked to (e.g. SB-345). */
	itemKey: string;
	/** Address of the project the item belongs to (acme/roadmap). */
	projectRef: string;
	path: string;
	type: SpecType;
	createdAt: string;
}

export type SyncStatus = 'pending' | 'syncing' | 'committing' | 'completed' | 'failed';

export interface ApiProject {
	id: string;
	/** URL identifier for this project, unique per owner (e.g. "roadmap"). */
	slug: string;
	/** The owner's user slug; the project's address is ownerSlug/slug (acme/roadmap). */
	ownerSlug: string;
	/** The owner's display name. */
	ownerName: string;
	/** Short uppercase prefix for this project's item keys (e.g. "SB"). */
	key: string;
	name: string;
	description?: string;
	storageMode: StorageMode;
	repository: RepositoryConfig | Record<string, never>;
	rootPaths: string[];
	systemPrompt?: string;
	syncStatus: SyncStatus | null;
	syncError: string | null;
	createdAt: string;
	updatedAt: string;
	/** The caller's role as granted: owner for their own projects, else their membership's. */
	grantedRole: ProjectRole;
	/** The role access checks use: a granted editor without GitHub works as a viewer. */
	effectiveRole: ProjectRole;
}

/** One project as its own GET answers it: the caller's push access rides along. */
export interface ApiProjectDetail extends ApiProject {
	/** The caller's GitHub login; null without a connection. */
	githubUsername: string | null;
	/** Whether the caller's GitHub account can push to the repository; null when unknown or not applicable. */
	pushAccess: boolean | null;
}
