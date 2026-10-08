/**
 * Project invitation handlers, the owner's side: invite, list pending, resend, revoke.
 *
 * Every route is owner-only behind requireProjectAccess. Inviting answers the same way
 * whether or not the address has an account; the email is the only thing that reaches
 * the invitee, and the /invite page sorts out signing in or signing up. Sending and
 * resending share one per-owner rate limit, since each sends an email.
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { checkRateLimitKey, generateToken, hashToken, RATE_LIMIT_CONFIGS } from '@specboard/auth';
import {
	createInvitation,
	listPendingInvitations,
	resendInvitation,
	revokeInvitation,
	INVITATION_TTL_DAYS,
	type IssuedInvitation,
	type MemberRole,
} from '@specboard/db';
import { sendEmail, getProjectInvitationEmailContent } from '@specboard/email';
import { isValidEmail, isValidUUID } from '../validation.ts';
import { apiUserId, requireResolvedProject } from '../project-access.ts';
import { jsonObjectBody } from '../request-body.ts';
import { APP_URL } from './auth/utils.ts';

const MEMBER_ROLES: ReadonlySet<string> = new Set<MemberRole>(['editor', 'viewer']);

const MAX_EMAIL_LENGTH = 255;

const CONFLICT_RESPONSES = {
	owner: { error: "That's the project owner's address", code: 'PROJECT_OWNER' },
	member: { error: 'Someone with that address is already a member of this project', code: 'ALREADY_MEMBER' },
} as const;

const NOT_PENDING = { error: 'No pending invitation with that id' } as const;

/** Email the invite link. Fire-and-forget like the magic link: the owner can resend. */
function sendInvitationEmail(token: string, { invitation, projectName, inviterName }: IssuedInvitation): void {
	const content = getProjectInvitationEmailContent({
		inviterName,
		projectName,
		role: invitation.role,
		inviteUrl: `${APP_URL}/invite?token=${token}`,
		expiresInDays: INVITATION_TTL_DAYS,
	});
	sendEmail({ to: invitation.email, ...content }).catch((error: unknown) => {
		console.error('Invitation email failed:', error instanceof Error ? error.message : 'Unknown error');
	});
}

/** Count an invitation email against the owner's budget. False when it is spent. */
function withinInviteLimit(redis: Redis, userId: string): Promise<boolean> {
	return checkRateLimitKey(redis, `ratelimit:project-invite:${userId}`, RATE_LIMIT_CONFIGS.projectInvite);
}

const RATE_LIMITED = { error: RATE_LIMIT_CONFIGS.projectInvite.message } as const;

/** POST /api/projects/:owner/:project/invitations, body { email, role } */
export async function handleCreateInvitation(context: Context, redis: Redis): Promise<Response> {
	const body = await jsonObjectBody<{ email?: unknown; role?: unknown }>(context);
	if (body instanceof Response) return body;
	const { email, role } = body;

	const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
	if (!address || address.length > MAX_EMAIL_LENGTH || !isValidEmail(address)) {
		return context.json({ error: 'A valid email address is required' }, 400);
	}
	if (typeof role !== 'string' || !MEMBER_ROLES.has(role)) {
		return context.json({ error: 'Role must be editor or viewer' }, 400);
	}

	const userId = apiUserId(context);
	if (!await withinInviteLimit(redis, userId)) {
		return context.json(RATE_LIMITED, 429);
	}

	const token = generateToken();
	try {
		const result = await createInvitation({
			projectId: requireResolvedProject(context).id,
			email: address,
			role: role as MemberRole,
			invitedBy: userId,
			tokenHash: hashToken(token),
		});
		if ('conflict' in result) {
			return context.json(CONFLICT_RESPONSES[result.conflict], 409);
		}
		sendInvitationEmail(token, result.issued);
		return context.json(result.issued.invitation, 201);
	} catch (error) {
		console.error('Failed to create invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /api/projects/:owner/:project/invitations: open and expired, not yet answered or revoked. */
export async function handleListInvitations(context: Context): Promise<Response> {
	try {
		return context.json(await listPendingInvitations(requireResolvedProject(context).id));
	} catch (error) {
		console.error('Failed to list invitations:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /api/projects/:owner/:project/invitations/:invitation/resend: a new link, a fresh seven days. */
export async function handleResendInvitation(context: Context, redis: Redis): Promise<Response> {
	const invitationId = context.req.param('invitation');
	if (!isValidUUID(invitationId)) {
		return context.json(NOT_PENDING, 404);
	}
	if (!await withinInviteLimit(redis, apiUserId(context))) {
		return context.json(RATE_LIMITED, 429);
	}

	const token = generateToken();
	try {
		const issued = await resendInvitation(requireResolvedProject(context).id, invitationId, hashToken(token));
		if (!issued) {
			return context.json(NOT_PENDING, 404);
		}
		sendInvitationEmail(token, issued);
		return context.json(issued.invitation);
	} catch (error) {
		console.error('Failed to resend invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /api/projects/:owner/:project/invitations/:invitation: revoke. The row stays, stamped. */
export async function handleRevokeInvitation(context: Context): Promise<Response> {
	const invitationId = context.req.param('invitation');
	if (!isValidUUID(invitationId)) {
		return context.json(NOT_PENDING, 404);
	}

	try {
		if (!await revokeInvitation(requireResolvedProject(context).id, invitationId)) {
			return context.json(NOT_PENDING, 404);
		}
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to revoke invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
