/**
 * Transform functions: service responses → API JSON (ISO date strings).
 *
 * Item/spec/progress responses already come back camelCase from the item service
 * and are returned directly by their handlers; only projects need a transform here.
 */

import type { ProjectResponse } from '@specboard/db';
import type { ApiProject } from './types.ts';

/** Transform ProjectResponse (camelCase from the service) to ApiProject (ISO strings). */
export function projectResponseToApi(project: ProjectResponse): ApiProject {
	return {
		id: project.id,
		name: project.name,
		description: project.description ?? undefined,
		ownerId: project.ownerId,
		storageMode: project.storageMode,
		repository: project.repository,
		rootPaths: project.rootPaths,
		systemPrompt: project.systemPrompt ?? undefined,
		syncStatus: project.syncStatus,
		syncError: project.syncError,
		createdAt: project.createdAt.toISOString(),
		updatedAt: project.updatedAt.toISOString(),
	};
}
