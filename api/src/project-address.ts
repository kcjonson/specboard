/**
 * The `/api/projects/:owner/:project/...` address every project-scoped route carries.
 * Handlers read it here and resolve it with resolveProject, the one resolver shared
 * with MCP, so no route can look a project up some other way.
 */

import type { Context } from 'hono';
import { getProject, resolveProject, type ProjectResponse } from '@specboard/db';
import { isValidProjectSlug, isValidUserSlug } from '@specboard/core/identifiers';

export interface ProjectAddress {
	owner: string;
	project: string;
}

/** The :owner/:project path params, or null when either half is malformed. */
export function readProjectAddress(context: Context): ProjectAddress | null {
	const owner = context.req.param('owner');
	const project = context.req.param('project');
	return isValidUserSlug(owner) && isValidProjectSlug(project) ? { owner, project } : null;
}

/** Resolve an address to the full project, for handlers that need more than its id. */
export async function loadProject(address: ProjectAddress, userId: string): Promise<ProjectResponse | null> {
	const resolved = await resolveProject(address.owner, address.project, userId);
	return resolved ? getProject(resolved.id, userId) : null;
}
