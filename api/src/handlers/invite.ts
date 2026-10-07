/**
 * Project invitation handlers, the invitee's side.
 *
 * The emailed token only finds an invitation: `GET /api/invite?token=` is what the
 * /invite page shows anyone holding the link, with the invited address masked, and no
 * side effects (mail scanners prefetch links). Everything after that goes by the
 * invitation's id, for a signed-in account whose verified email is the invited address:
 * reading it, accepting, declining, and the user's own list. So the raw token never
 * needs to travel past the first page load, and a forwarded link or a guessed id can't
 * be used by anyone else.
 *
 * None of these are project routes: the caller isn't a member yet, so
 * requireProjectAccess has nothing to check. The address binding is the check.
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, hashToken, SESSION_COOKIE_NAME } from '@specboard/auth';
import {
	acceptInvitation,
	declineInvitation,
	getInvitationByTokenHash,
	getInvitationForUser,
	listInvitationsForUser,
	newerOpenInvitationId,
	type InvitationDetails,
	type InvitationRefusal,
} from '@specboard/db';
import { formatProjectRef } from '@specboard/core/identifiers';
import { isValidUUID } from '../validation.ts';

export const INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const NOT_FOUND = { error: 'Invitation not found', code: 'NOT_FOUND' } as const;

const CLOSED_MESSAGES = {
	expired: 'This invitation has expired',
	revoked: 'This invitation was revoked',
	accepted: 'This invitation has already been accepted',
	declined: 'This invitation was declined',
} as const;

/** The signed-in user, or null. A Redis outage reads as signed out rather than a 500. */
async function sessionUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;
	const session = await getSession(redis, sessionId).catch((error: unknown) => {
		console.error('Invitation session lookup error:', error instanceof Error ? error.message : error);
		return null;
	});
	return session?.userId ?? null;
}

/** `kevin@example.com` as `k•••@example.com`: enough to recognize, not enough to harvest. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

function projectOf(invitation: InvitationDetails): { ref: string; name: string } {
	return { ref: formatProjectRef(invitation.ownerSlug, invitation.projectSlug), name: invitation.projectName };
}

/**
 * The invite card. Its recipient also gets the project, so an accepted invite can link
 * to it, and for a revoked or expired invite the open one that replaced it, if any (the
 * owner invited them again, say while they were signing up).
 */
async function inviteView(invitation: InvitationDetails, addressedToYou: boolean | null): Promise<Record<string, unknown>> {
	const view: Record<string, unknown> = {
		id: invitation.id,
		state: invitation.state,
		role: invitation.role,
		projectName: invitation.projectName,
		ownerName: invitation.ownerName,
		inviterName: invitation.inviterName,
		email: maskEmail(invitation.email),
		addressedToYou,
	};
	if (addressedToYou) {
		view.project = projectOf(invitation);
		if (invitation.state !== 'open' && invitation.state !== 'accepted') {
			view.openInvitationId = await newerOpenInvitationId(invitation.id);
		}
	}
	return view;
}

/**
 * Why an answer was refused, as a response. An invitation addressed to someone else is
 * a 404 like an id that doesn't exist.
 */
function refusalResponse(context: Context, refusal: InvitationRefusal): Response {
	switch (refusal.refused) {
		case 'not_found':
		case 'wrong_account':
			return context.json(NOT_FOUND, 404);
		case 'closed':
			return context.json({ error: CLOSED_MESSAGES[refusal.state], code: 'INVITATION_CLOSED', state: refusal.state }, 410);
		case 'owner':
			return context.json({ error: 'You own this project', code: 'PROJECT_OWNER' }, 409);
		case 'no_slug':
			return context.json({ error: 'Finish setting up your account before accepting', code: 'ONBOARDING_REQUIRED' }, 409);
	}
}

/**
 * GET /api/invite?token=: what the /invite page shows. No side effects. Anyone holding
 * the link may look; `addressedToYou` is null signed out, else whether the signed-in
 * account can answer it.
 */
export async function handleLookupInvite(context: Context, redis: Redis): Promise<Response> {
	const token = context.req.query('token') ?? '';
	if (!INVITE_TOKEN_PATTERN.test(token)) {
		return context.json(NOT_FOUND, 404);
	}

	try {
		const invitation = await getInvitationByTokenHash(hashToken(token));
		if (!invitation) {
			return context.json(NOT_FOUND, 404);
		}
		const userId = await sessionUserId(context, redis);
		const addressedToYou = userId ? (await getInvitationForUser(invitation.id, userId)) !== null : null;
		return context.json(await inviteView(invitation, addressedToYou));
	} catch (error) {
		console.error('Failed to look up invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /api/invitations: the signed-in user's open, unexpired invitations, newest first. */
export async function handleListMyInvitations(context: Context, redis: Redis): Promise<Response> {
	const userId = await sessionUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const invitations = await listInvitationsForUser(userId);
		return context.json(invitations.map((invitation) => ({
			id: invitation.id,
			role: invitation.role,
			project: projectOf(invitation),
			ownerName: invitation.ownerName,
			inviterName: invitation.inviterName,
			createdAt: invitation.createdAt,
			expiresAt: invitation.expiresAt,
		})));
	} catch (error) {
		console.error('Failed to list invitations:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /api/invitations/:id: one invitation addressed to the signed-in user, in any state. */
export async function handleGetMyInvitation(context: Context, redis: Redis): Promise<Response> {
	const userId = await sessionUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}
	const id = context.req.param('id');
	if (!isValidUUID(id)) {
		return context.json(NOT_FOUND, 404);
	}

	try {
		const invitation = await getInvitationForUser(id, userId);
		if (!invitation) {
			return context.json(NOT_FOUND, 404);
		}
		return context.json(await inviteView(invitation, true));
	} catch (error) {
		console.error('Failed to read invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

type Answer = 'accept' | 'decline';

/** Accept or decline the invitation in the path, for the signed-in user. */
async function answer(context: Context, redis: Redis, action: Answer): Promise<Response> {
	const userId = await sessionUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}
	const id = context.req.param('id');
	if (!isValidUUID(id)) {
		return context.json(NOT_FOUND, 404);
	}

	try {
		if (action === 'accept') {
			const result = await acceptInvitation(id, userId);
			if ('refused' in result) return refusalResponse(context, result);
			return context.json({ project: projectOf(result.invitation), role: result.role, alreadyMember: result.alreadyMember });
		}
		const result = await declineInvitation(id, userId);
		if ('refused' in result) return refusalResponse(context, result);
		return context.json({ success: true });
	} catch (error) {
		console.error(`Failed to ${action} invitation:`, error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /api/invitations/:id/accept */
export function handleAcceptMyInvitation(context: Context, redis: Redis): Promise<Response> {
	return answer(context, redis, 'accept');
}

/** POST /api/invitations/:id/decline */
export function handleDeclineMyInvitation(context: Context, redis: Redis): Promise<Response> {
	return answer(context, redis, 'decline');
}
