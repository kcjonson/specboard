/**
 * Project invitation handlers, the invitee's side.
 *
 * Two ways in. The emailed link opens the /invite page, which looks the invitation up
 * by token and accepts or declines it by token (`/api/invite...`). A signed-in user's
 * projects list shows the open invitations addressed to them and answers by id
 * (`/api/invitations...`). Neither is a project route: the caller isn't a member yet,
 * so requireProjectAccess has nothing to check. Instead every answer requires a session
 * whose account's verified email is the invited address, so a forwarded link or a
 * guessed id can't be used by anyone else.
 *
 * The token lookup is a GET with no side effects (mail scanners prefetch links); it
 * tells the visitor only what the invite card shows, with the invited address masked.
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, hashToken, SESSION_COOKIE_NAME } from '@specboard/auth';
import {
	acceptInvitation,
	declineInvitation,
	getInvitationByTokenHash,
	isInvitationAddressedTo,
	listInvitationsForUser,
	type InvitationDetails,
	type InvitationRefusal,
	type InvitationTarget,
} from '@specboard/db';
import { formatProjectRef } from '@specboard/core/identifiers';
import { isValidUUID } from '../validation.ts';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

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
 * Why an answer was refused, as a response. Answering by id, an invitation addressed to
 * someone else is a 404 like an id that doesn't exist; by token, the page needs to say
 * it was sent to another address, so it is a 403.
 */
function refusalResponse(context: Context, refusal: InvitationRefusal, by: 'token' | 'id'): Response {
	switch (refusal.refused) {
		case 'not_found':
			return context.json(NOT_FOUND, 404);
		case 'wrong_account':
			return by === 'id'
				? context.json(NOT_FOUND, 404)
				: context.json({ error: 'This invitation was sent to a different email address', code: 'WRONG_ACCOUNT' }, 403);
		case 'closed':
			return context.json({ error: CLOSED_MESSAGES[refusal.state], code: 'INVITATION_CLOSED', state: refusal.state }, 410);
		case 'owner':
			return context.json({ error: 'You own this project', code: 'PROJECT_OWNER' }, 409);
		case 'no_slug':
			return context.json({ error: 'Finish setting up your account before accepting', code: 'ONBOARDING_REQUIRED' }, 409);
	}
}

/** The token from a POST body, or null when it isn't one. */
async function bodyToken(context: Context): Promise<string | null> {
	try {
		const body = await context.req.json<unknown>();
		const token = (body as { token?: unknown } | null)?.token;
		return typeof token === 'string' && TOKEN_PATTERN.test(token) ? token : null;
	} catch {
		return null;
	}
}

type Answer = 'accept' | 'decline';

/** Accept or decline, for the signed-in user. A null target is a malformed token or id. */
async function answer(context: Context, redis: Redis, target: InvitationTarget | null, action: Answer): Promise<Response> {
	const userId = await sessionUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}
	if (!target) {
		return context.json(NOT_FOUND, 404);
	}
	const by = 'id' in target ? 'id' : 'token';

	try {
		if (action === 'accept') {
			const result = await acceptInvitation(target, userId);
			if ('refused' in result) return refusalResponse(context, result, by);
			return context.json({ project: projectOf(result.invitation), role: result.role, alreadyMember: result.alreadyMember });
		}
		const result = await declineInvitation(target, userId);
		if ('refused' in result) return refusalResponse(context, result, by);
		return context.json({ success: true });
	} catch (error) {
		console.error(`Failed to ${action} invitation:`, error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/**
 * GET /api/invite?token=: what the /invite page shows. No side effects. Anyone holding
 * the link may look; `addressedToYou` is null signed out, else whether the signed-in
 * account can answer it.
 */
export async function handleLookupInvite(context: Context, redis: Redis): Promise<Response> {
	const token = context.req.query('token') ?? '';
	if (!TOKEN_PATTERN.test(token)) {
		return context.json(NOT_FOUND, 404);
	}

	try {
		const tokenHash = hashToken(token);
		const invitation = await getInvitationByTokenHash(tokenHash);
		if (!invitation) {
			return context.json(NOT_FOUND, 404);
		}
		const userId = await sessionUserId(context, redis);
		return context.json({
			state: invitation.state,
			role: invitation.role,
			projectName: invitation.projectName,
			ownerName: invitation.ownerName,
			inviterName: invitation.inviterName,
			email: maskEmail(invitation.email),
			addressedToYou: userId ? await isInvitationAddressedTo(tokenHash, userId) : null,
		});
	} catch (error) {
		console.error('Failed to look up invitation:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /api/invite/accept, body { token } */
export async function handleAcceptInvite(context: Context, redis: Redis): Promise<Response> {
	const token = await bodyToken(context);
	return answer(context, redis, token ? { tokenHash: hashToken(token) } : null, 'accept');
}

/** POST /api/invite/decline, body { token } */
export async function handleDeclineInvite(context: Context, redis: Redis): Promise<Response> {
	const token = await bodyToken(context);
	return answer(context, redis, token ? { tokenHash: hashToken(token) } : null, 'decline');
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

function idTarget(context: Context): InvitationTarget | null {
	const id = context.req.param('id');
	return isValidUUID(id) ? { id } : null;
}

/** POST /api/invitations/:id/accept */
export function handleAcceptMyInvitation(context: Context, redis: Redis): Promise<Response> {
	return answer(context, redis, idTarget(context), 'accept');
}

/** POST /api/invitations/:id/decline */
export function handleDeclineMyInvitation(context: Context, redis: Redis): Promise<Response> {
	return answer(context, redis, idTarget(context), 'decline');
}
