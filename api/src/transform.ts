/**
 * Transform functions: service responses → API JSON (ISO date strings).
 *
 * Item/spec/note responses already come back camelCase from the services
 * and are returned directly by their handlers; only projects need a transform here.
 */

import { isLocalRepository, type ProjectAccess, type ProjectResponse } from '@specboard/db';
import type { ApiProject } from './types.ts';

/**
 * Transform ProjectResponse (camelCase from the service) to ApiProject (ISO strings),
 * with the caller's role on it. A local project's repository is a path on its owner's
 * disk; members see the project as board-only, so they get no repository at all.
 */
export function projectResponseToApi(
	project: ProjectResponse,
	{ grantedRole, effectiveRole }: Pick<ProjectAccess, 'grantedRole' | 'effectiveRole'>
): ApiProject {
	return {
		id: project.id,
		slug: project.slug,
		ownerSlug: project.ownerSlug,
		key: project.key,
		name: project.name,
		description: project.description ?? undefined,
		storageMode: project.storageMode,
		repository: isLocalRepository(project.repository) && grantedRole !== 'owner' ? {} : project.repository,
		rootPaths: project.rootPaths,
		systemPrompt: project.systemPrompt ?? undefined,
		syncStatus: project.syncStatus,
		syncError: project.syncError,
		createdAt: project.createdAt.toISOString(),
		updatedAt: project.updatedAt.toISOString(),
		grantedRole,
		effectiveRole,
	};
}
