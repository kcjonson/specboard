/**
 * Project member handlers: list, change a role, remove, and leave.
 *
 * requireProjectAccess decides who may call each (listing and leaving are viewer,
 * changing and removing are owner). Members are addressed by user slug and answered
 * with the member view, which carries no user id. The owner isn't a membership, so
 * none of these can change, remove, or take the owner out of their own project.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import {
	getProject,
	leaveProject,
	listProjectMembers,
	removeProjectMember,
	setProjectMemberRole,
	type MemberRole,
} from '@specboard/db';
import { isValidUserSlug } from '@specboard/core/identifiers';
import { apiUserId, requireAccess, requireResolvedProject } from '../project-access.ts';
import { memberPushAccess } from '../services/push-access.ts';
import { jsonObjectBody } from '../request-body.ts';

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

/**
 * Each member's push access, for the owner's view only (the spec's "on the member's row
 * (owner view)"); anyone else sees their own on the project GET. Advisory, so it never
 * fails the list: any error leaves every row null.
 */
async function pushAccessForOwner(context: Context, redis: Redis, projectId: string): Promise<Map<string, boolean | null>> {
	if (requireAccess(context).grantedRole !== 'owner' || context.req.query('pushAccess') === 'false') return new Map();
	try {
		const project = await getProject(projectId);
		return project ? await memberPushAccess(redis, project) : new Map();
	} catch (error) {
		console.error('Failed to check member push access:', error);
		return new Map();
	}
}

/**
 * GET /api/projects/:owner/:project/members. For the owner, each member carries
 * `pushAccess`, whether their own GitHub account can push to the project's repository
 * (null when unknown, or when there is no repository or no connection), so the owner can
 * see who will be refused. Every other caller gets null on every row, and so does the owner
 * with `?pushAccess=false`: the check can wait up to a second per uncached member on GitHub,
 * and a list that only needs the people (the assignee picker) shouldn't.
 */
export async function handleListMembers(context: Context, redis: Redis): Promise<Response> {
	const projectId = requireResolvedProject(context).id;
	try {
		const [members, pushAccess] = await Promise.all([
			listProjectMembers(projectId),
			pushAccessForOwner(context, redis, projectId),
		]);
		return context.json(members.map((member) => ({
			...member,
			pushAccess: (member.slug && pushAccess.get(member.slug)) ?? null,
		})));
	} catch (error) {
		console.error('Failed to list members:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** PUT /api/projects/:owner/:project/members/:member, body { role: 'editor' | 'viewer' } */
export async function handleUpdateMember(context: Context): Promise<Response> {
	const slug = memberSlug(context);
	if (slug instanceof Response) return slug;

	const body = await jsonObjectBody<{ role?: unknown }>(context);
	if (body instanceof Response) return body;
	const { role } = body;
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
