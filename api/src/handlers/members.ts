/**
 * Project member handlers: list, change a role, remove, and leave.
 *
 * requireProjectAccess decides who may call each (listing and leaving are viewer,
 * changing and removing are owner). Members are addressed by user slug and answered
 * with the member view, which carries no user id. The owner isn't a membership, so
 * none of these can change, remove, or take the owner out of their own project.
 */

import type { Context } from 'hono';
import {
	leaveProject,
	listProjectMembers,
	removeProjectMember,
	setProjectMemberRole,
	type MemberRole,
} from '@specboard/db';
import { isValidUserSlug } from '@specboard/core/identifiers';
import { apiUserId, requireAccess, requireResolvedProject } from '../project-access.ts';

const MEMBER_ROLES: ReadonlySet<string> = new Set<MemberRole>(['editor', 'viewer']);

const OWNER_RESPONSE = { error: "The project owner isn't a member and can't be changed here", code: 'PROJECT_OWNER' } as const;

/**
 * The :member path segment, or an error Response. The owner's slug is refused before
 * any lookup; a slug that isn't one at all can't name a member, so it is a 404 like any
 * other non-member.
 */
function memberSlug(context: Context): string | Response {
	const slug = context.req.param('member');
	if (slug === requireResolvedProject(context).ownerSlug) return context.json(OWNER_RESPONSE, 409);
	if (!isValidUserSlug(slug)) return context.json({ error: 'Member not found' }, 404);
	return slug;
}

/** GET /api/projects/:owner/:project/members */
export async function handleListMembers(context: Context): Promise<Response> {
	try {
		return context.json(await listProjectMembers(requireResolvedProject(context).id));
	} catch (error) {
		console.error('Failed to list members:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** PUT /api/projects/:owner/:project/members/:member, body { role: 'editor' | 'viewer' } */
export async function handleUpdateMember(context: Context): Promise<Response> {
	const slug = memberSlug(context);
	if (slug instanceof Response) return slug;

	let body: unknown;
	try {
		body = await context.req.json();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
	const role = (body as { role?: unknown } | null)?.role;
	if (typeof role !== 'string' || !MEMBER_ROLES.has(role)) {
		return context.json({ error: 'Role must be editor or viewer' }, 400);
	}

	try {
		const member = await setProjectMemberRole(requireResolvedProject(context).id, slug, role as MemberRole);
		if (!member) {
			return context.json({ error: 'Member not found' }, 404);
		}
		return context.json(member);
	} catch (error) {
		console.error('Failed to change member role:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /api/projects/:owner/:project/members/:member */
export async function handleRemoveMember(context: Context): Promise<Response> {
	const slug = memberSlug(context);
	if (slug instanceof Response) return slug;

	try {
		const removed = await removeProjectMember(requireResolvedProject(context).id, slug);
		if (!removed) {
			return context.json({ error: 'Member not found' }, 404);
		}
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to remove member:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /api/projects/:owner/:project/membership: the caller leaves the project. */
export async function handleLeaveProject(context: Context): Promise<Response> {
	if (requireAccess(context).grantedRole === 'owner') {
		return context.json({ error: "The project owner can't leave their own project", code: 'PROJECT_OWNER' }, 409);
	}

	try {
		await leaveProject(requireResolvedProject(context).id, apiUserId(context));
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to leave project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
