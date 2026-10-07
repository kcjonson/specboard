/**
 * Project member service: the people on a project and their roles.
 *
 * Every function takes a project id that resolveProjectAccess has already authorized;
 * which caller may list, change or remove is the route's minimum role, not decided
 * here. Members are addressed by user slug, so no user id leaves this module.
 */

import { query } from '../index.ts';
import { effectiveRoleSql, type MemberRole, type ProjectRole } from './projects.ts';
import { USER_DISPLAY_NAME_SQL } from './users.ts';

export interface ProjectMember {
	/** The member's user slug, how the API addresses them. NULL only before onboarding. */
	slug: string | null;
	name: string;
	email: string;
	avatarUrl: string | null;
	/** The granted role; owner for the project's owner. */
	role: ProjectRole;
	/** The role access checks use: a granted editor without GitHub works as a viewer. */
	effectiveRole: ProjectRole;
	githubConnected: boolean;
}

interface MemberRow {
	slug: string | null;
	name: string;
	email: string;
	avatar_url: string | null;
	role: ProjectRole;
	effective_role: ProjectRole;
	github_connected: boolean;
}

function toMember(row: MemberRow): ProjectMember {
	return {
		slug: row.slug,
		name: row.name,
		email: row.email,
		avatarUrl: row.avatar_url,
		role: row.role,
		effectiveRole: row.effective_role,
		githubConnected: row.github_connected,
	};
}

const GITHUB_CONNECTED_SQL = 'EXISTS (SELECT 1 FROM github_connections gc WHERE gc.user_id = u.id)';

/** The member view's columns, over a `users` row aliased `u` and a granted-role expression. */
function memberColumns(role: string): string {
	return `u.slug, ${USER_DISPLAY_NAME_SQL} AS name, u.email, u.avatar_url, ${role} AS role,
		${effectiveRoleSql(role, GITHUB_CONNECTED_SQL)} AS effective_role,
		${GITHUB_CONNECTED_SQL} AS github_connected`;
}

/** The owner first, then the members in the order they joined. */
export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
	const result = await query<MemberRow>(
		`SELECT ${memberColumns('r.role')}
		 FROM (
			SELECT p.owner_id AS user_id, 'owner' AS role, NULL::timestamptz AS joined_at
			FROM projects p WHERE p.id = $1
			UNION ALL
			SELECT m.user_id, m.role, m.created_at
			FROM project_members m WHERE m.project_id = $1
		 ) r
		 JOIN users u ON u.id = r.user_id
		 ORDER BY r.joined_at NULLS FIRST, u.slug`,
		[projectId]
	);
	return result.rows.map(toMember);
}

/** Change a member's granted role. Null when no member of the project has that slug. */
export async function setProjectMemberRole(
	projectId: string,
	memberSlug: string,
	role: MemberRole
): Promise<ProjectMember | null> {
	const result = await query<MemberRow>(
		`UPDATE project_members m SET role = $3
		 FROM users u
		 WHERE u.id = m.user_id AND m.project_id = $1 AND u.slug = $2
		 RETURNING ${memberColumns('m.role')}`,
		[projectId, memberSlug, role]
	);
	const row = result.rows[0];
	return row ? toMember(row) : null;
}

/** Remove a member by slug. False when no member of the project has that slug. */
export async function removeProjectMember(projectId: string, memberSlug: string): Promise<boolean> {
	const result = await query(
		`DELETE FROM project_members m
		 USING users u
		 WHERE u.id = m.user_id AND m.project_id = $1 AND u.slug = $2`,
		[projectId, memberSlug]
	);
	return (result.rowCount ?? 0) > 0;
}

/** Remove the caller's own membership. Leaving twice is not an error. */
export async function leaveProject(projectId: string, userId: string): Promise<void> {
	await query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
}
