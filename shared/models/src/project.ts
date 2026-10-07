/**
 * The open project, and the caller's standing on it.
 *
 * One ProjectModel per project ref for the whole page, shared by the header, the banner
 * and whichever view is open, so they all read the same role from one request. The
 * server is the authority on every write; this only lets the UI avoid offering what it
 * would refuse, and say why (docs/specs/multi-user-collaboration.md, Read-only mode).
 */

import { useMemo } from 'preact/hooks';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { useModel } from './hooks';

/** A role on a project. The owner owns it; editor and viewer are memberships. */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type StorageMode = 'none' | 'local' | 'cloud';

/** The parts of a project's repository the UI reads. A member of a local project gets `{}`. */
export interface ProjectRepository {
	type?: 'local' | 'cloud';
	remote?: { provider: 'github'; owner: string; repo: string; url: string };
	branch?: string;
}

/**
 * Why the caller can't edit, or what they should know before they try:
 * - `viewer`: granted view access
 * - `github_not_connected`: granted editor, no GitHub connection yet
 * - `no_push_access`: can edit, but their GitHub account can't push to the repository,
 *   so commits will be refused. A warning; nothing is made read-only for it.
 */
export type ProjectRoleReason = 'viewer' | 'github_not_connected' | 'no_push_access';

export interface ProjectRoleState {
	/** The granted role; null until the project has loaded. */
	role: ProjectRole | null;
	/** The role access checks use; null until the project has loaded. */
	effectiveRole: ProjectRole | null;
	reason: ProjectRoleReason | null;
	/** Whether to offer writes. False until the project has loaded. */
	canEdit: boolean;
	/** Whether the caller owns the project (settings, members, local folders). */
	isOwner: boolean;
}

/** GET /api/projects/:owner/:project */
export class ProjectModel extends SyncModel {
	static override url = '/api/projects/:projectRef';

	@prop accessor projectRef!: string;
	@prop accessor id!: string;
	@prop accessor slug!: string;
	@prop accessor ownerSlug!: string;
	@prop accessor ownerName!: string;
	@prop accessor key!: string;
	@prop accessor name!: string;
	@prop accessor storageMode!: StorageMode;
	@prop accessor repository!: ProjectRepository;
	@prop accessor grantedRole!: ProjectRole;
	@prop accessor effectiveRole!: ProjectRole;
	/** Whether the caller's GitHub account can push to the repository; null when unknown or not applicable. */
	@prop accessor pushAccess!: boolean | null;
}

const projects = new Map<string, ProjectModel>();

/**
 * The page's model for a project ref, fetched on first use. A failed fetch lands on
 * `$meta.error` and leaves the role unknown, which reads as "can't edit".
 */
export function projectModel(projectRef: string): ProjectModel {
	let project = projects.get(projectRef);
	if (!project) {
		project = new ProjectModel({ projectRef });
		projects.set(projectRef, project);
		project.fetch().catch(() => undefined);
	}
	return project;
}

/**
 * Re-read the project, for when the caller's role may have moved under the page: a
 * new page view, or a write the server refused. Concurrent calls share one request.
 */
export function refreshProject(projectRef: string): void {
	const project = projects.get(projectRef);
	if (!project) {
		projectModel(projectRef);
	} else if (!project.$meta.working) {
		project.fetch().catch(() => undefined);
	}
}

/** The caller's standing, from the fields the server sent. The one place the client reads them. */
export function projectRoleState(project: Pick<ProjectModel, 'grantedRole' | 'effectiveRole' | 'pushAccess'>): ProjectRoleState {
	const role = project.grantedRole ?? null;
	const effectiveRole = project.effectiveRole ?? null;
	const canEdit = effectiveRole === 'owner' || effectiveRole === 'editor';

	let reason: ProjectRoleReason | null = null;
	if (effectiveRole === 'viewer') {
		reason = role === 'editor' ? 'github_not_connected' : 'viewer';
	} else if (canEdit && project.pushAccess === false) {
		reason = 'no_push_access';
	}

	return { role, effectiveRole, reason, canEdit, isOwner: role === 'owner' };
}

/** Subscribe to the page's project. */
export function useProject(projectRef: string): ProjectModel {
	const project = useMemo(() => projectModel(projectRef), [projectRef]);
	useModel(project);
	return project;
}

/** The caller's role on the project and whether to offer writes. */
export function useProjectRole(projectRef: string): ProjectRoleState {
	return projectRoleState(useProject(projectRef));
}
