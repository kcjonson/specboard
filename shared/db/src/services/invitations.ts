/**
 * Project invitation service (docs/specs/multi-user-collaboration.md, Invitation Flow).
 *
 * An owner invites an email address with a role; the invitee accepts or declines from
 * the emailed link or their projects list. Callers hash the token: only its SHA-256
 * reaches this module. The token only finds an invitation; answering one goes by id,
 * for a signed-in account the invitation is addressed to. Rows are never deleted. Re-inviting revokes the open row, and
 * accepting, declining or revoking stamps it, so the owner's view keeps the history.
 *
 * Owner-side functions take a project id that resolveProjectAccess has already
 * authorized for the owner. Invitee-side functions decide for themselves, from the
 * caller's account, whether the invitation is addressed to them.
 */

import type pg from 'pg';
import { query, transaction } from '../index.ts';
import type { MemberRole } from './projects.ts';
import { USER_DISPLAY_NAME_SQL } from './users.ts';

/** How long an invitation link stays good, from sending or the last resend. */
export const INVITATION_TTL_DAYS = 7;

/** Where an invitation stands. Expired is an open row past its expiry. */
export type InvitationState = 'open' | 'expired' | 'revoked' | 'accepted' | 'declined';

/** An invitation the owner still sees as pending: not accepted, declined or revoked. */
export interface PendingInvitation {
	id: string;
	email: string;
	role: MemberRole;
	/** Display name of whoever sent it, null if their account is gone. */
	invitedBy: string | null;
	createdAt: Date;
	expiresAt: Date;
	state: Extract<InvitationState, 'open' | 'expired'>;
}

/** An invitation as its recipient sees it: what they're invited to, and by whom. */
export interface InvitationDetails {
	id: string;
	/** The invited address, lowercased. */
	email: string;
	role: MemberRole;
	state: InvitationState;
	projectName: string;
	projectSlug: string;
	ownerSlug: string;
	ownerName: string;
	/** The sender's display name; the owner's when the sender's account is gone. */
	inviterName: string;
	createdAt: Date;
	expiresAt: Date;
}

/** A just-issued invitation, with what its email says. */
export interface IssuedInvitation {
	invitation: PendingInvitation;
	projectName: string;
	inviterName: string;
}

const OPEN_SQL = 'i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL';

const STATE_SQL = `CASE
	WHEN i.accepted_at IS NOT NULL THEN 'accepted'
	WHEN i.declined_at IS NOT NULL THEN 'declined'
	WHEN i.revoked_at IS NOT NULL THEN 'revoked'
	WHEN i.expires_at <= NOW() THEN 'expired'
	ELSE 'open' END`;

const EXPIRES_SQL = `NOW() + make_interval(days => ${INVITATION_TTL_DAYS})`;

const inviterNameSql = USER_DISPLAY_NAME_SQL.replace(/\bu\./g, 'inviter.');
const ownerNameSql = USER_DISPLAY_NAME_SQL.replace(/\bu\./g, 'owner.');

/** Columns and joins for a pending invitation over `i`, with what its email needs. */
const PENDING_SELECT = `SELECT i.id, i.email, i.role, ${inviterNameSql} AS invited_by,
		i.created_at, i.expires_at, ${STATE_SQL} AS state,
		p.name AS project_name, COALESCE(${inviterNameSql}, ${ownerNameSql}) AS inviter_name
	FROM project_invitations i
	JOIN projects p ON p.id = i.project_id
	JOIN users owner ON owner.id = p.owner_id
	LEFT JOIN users inviter ON inviter.id = i.invited_by`;

/** Columns and joins for an invitation as its recipient sees it. */
const DETAILS_SELECT = `SELECT i.id, i.email, i.role, ${STATE_SQL} AS state,
		p.name AS project_name, p.slug AS project_slug, owner.slug AS owner_slug,
		${ownerNameSql} AS owner_name, COALESCE(${inviterNameSql}, ${ownerNameSql}) AS inviter_name,
		i.created_at, i.expires_at
	FROM project_invitations i
	JOIN projects p ON p.id = i.project_id
	JOIN users owner ON owner.id = p.owner_id
	LEFT JOIN users inviter ON inviter.id = i.invited_by`;

interface PendingRow {
	id: string;
	email: string;
	role: MemberRole;
	invited_by: string | null;
	created_at: Date;
	expires_at: Date;
	state: PendingInvitation['state'];
	project_name: string;
	inviter_name: string;
}

interface DetailsRow {
	id: string;
	email: string;
	role: MemberRole;
	state: InvitationState;
	project_name: string;
	project_slug: string;
	owner_slug: string;
	owner_name: string;
	inviter_name: string;
	created_at: Date;
	expires_at: Date;
}

function toPending(row: PendingRow): PendingInvitation {
	return {
		id: row.id,
		email: row.email,
		role: row.role,
		invitedBy: row.invited_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		state: row.state,
	};
}

function toIssued(row: PendingRow): IssuedInvitation {
	return { invitation: toPending(row), projectName: row.project_name, inviterName: row.inviter_name };
}

function toDetails(row: DetailsRow): InvitationDetails {
	return {
		id: row.id,
		email: row.email,
		role: row.role,
		state: row.state,
		projectName: row.project_name,
		projectSlug: row.project_slug,
		ownerSlug: row.owner_slug,
		ownerName: row.owner_name,
		inviterName: row.inviter_name,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner side
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateInvitationInput {
	projectId: string;
	/** Lowercased by the caller. */
	email: string;
	role: MemberRole;
	invitedBy: string;
	tokenHash: string;
}

/**
 * Who already holds an invited address: the owner, an existing member, or nobody on the
 * project. Inviting either of the first two is refused.
 */
export type InvitationConflict = 'owner' | 'member';

export type CreateInvitationResult = { issued: IssuedInvitation } | { conflict: InvitationConflict };

async function addressConflict(client: pg.PoolClient, projectId: string, email: string): Promise<InvitationConflict | null> {
	const result = await client.query<{ conflict: InvitationConflict }>(
		`SELECT CASE WHEN p.owner_id = u.id THEN 'owner' ELSE 'member' END AS conflict
		 FROM users u
		 JOIN projects p ON p.id = $1
		 LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = u.id
		 WHERE LOWER(u.email) = $2 AND (p.owner_id = u.id OR m.user_id IS NOT NULL)`,
		[projectId, email]
	);
	return result.rows[0]?.conflict ?? null;
}

/**
 * Invite an address, revoking any invitation still open for it on this project. Refused
 * when the address is the owner's or a member's. Invites to one project take turns on
 * the project row, so two at once for the same address (a double click) run as if one
 * after the other, and the later one is the invitation left open.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
	return transaction(async (client) => {
		// NO KEY UPDATE: serializes invites without blocking the FK checks of item writes.
		await client.query('SELECT 1 FROM projects WHERE id = $1 FOR NO KEY UPDATE', [input.projectId]);

		const conflict = await addressConflict(client, input.projectId, input.email);
		if (conflict) return { conflict };

		await client.query(
			`UPDATE project_invitations i SET revoked_at = NOW()
			 WHERE i.project_id = $1 AND i.email = $2 AND ${OPEN_SQL}`,
			[input.projectId, input.email]
		);
		const inserted = await client.query<{ id: string }>(
			`INSERT INTO project_invitations (project_id, email, role, token_hash, invited_by, expires_at)
			 VALUES ($1, $2, $3, $4, $5, ${EXPIRES_SQL})
			 RETURNING id`,
			[input.projectId, input.email, input.role, input.tokenHash, input.invitedBy]
		);
		const result = await client.query<PendingRow>(`${PENDING_SELECT} WHERE i.id = $1`, [inserted.rows[0]!.id]);
		return { issued: toIssued(result.rows[0]!) };
	});
}

/** The project's pending invitations, open or expired, oldest first. */
export async function listPendingInvitations(projectId: string): Promise<PendingInvitation[]> {
	const result = await query<PendingRow>(
		`${PENDING_SELECT} WHERE i.project_id = $1 AND ${OPEN_SQL} ORDER BY i.created_at, i.email`,
		[projectId]
	);
	return result.rows.map(toPending);
}

/**
 * Send a pending invitation again: a new token, and the expiry restarts. The old link
 * stops working. Null when the project has no pending invitation with that id.
 */
export async function resendInvitation(
	projectId: string,
	invitationId: string,
	tokenHash: string
): Promise<IssuedInvitation | null> {
	const result = await query<PendingRow>(
		`WITH resent AS (
			UPDATE project_invitations i SET token_hash = $3, expires_at = ${EXPIRES_SQL}
			WHERE i.id = $2 AND i.project_id = $1 AND ${OPEN_SQL}
			RETURNING i.*
		)
		${PENDING_SELECT.replace('FROM project_invitations i', 'FROM resent i')}`,
		[projectId, invitationId, tokenHash]
	);
	const row = result.rows[0];
	return row ? toIssued(row) : null;
}

/** Revoke a pending invitation. False when the project has no pending invitation with that id. */
export async function revokeInvitation(projectId: string, invitationId: string): Promise<boolean> {
	const result = await query(
		`UPDATE project_invitations i SET revoked_at = NOW()
		 WHERE i.id = $2 AND i.project_id = $1 AND ${OPEN_SQL}`,
		[projectId, invitationId]
	);
	return (result.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitee side
// ─────────────────────────────────────────────────────────────────────────────

/** An invitation found by its emailed token, and whether it is addressed to whoever is looking. */
export interface TokenInvitation {
	invitation: InvitationDetails;
	/** Null when nobody is signed in. */
	addressedToViewer: boolean | null;
}

/**
 * The invitation an emailed token names, in whatever state it is in. With a viewer, also
 * whether they may answer it, in the same query.
 */
export async function getInvitationByTokenHash(tokenHash: string, viewerId: string | null): Promise<TokenInvitation | null> {
	const result = await query<DetailsRow & { addressed: boolean | null }>(
		`${DETAILS_SELECT.replace(/^SELECT /, `SELECT CASE WHEN $2::uuid IS NULL THEN NULL ELSE ${addressedToSql('$2::uuid')} END AS addressed, `)}
		 WHERE i.token_hash = $1`,
		[tokenHash, viewerId]
	);
	const row = result.rows[0];
	return row ? { invitation: toDetails(row), addressedToViewer: row.addressed } : null;
}

/**
 * The address an invitation was sent to, for checking a sign-in code typed on the signup
 * page it opened, which only knows the address masked. Null for an unknown id.
 */
export async function getInvitationAddress(invitationId: string): Promise<string | null> {
	const result = await query<{ email: string }>('SELECT email FROM project_invitations WHERE id = $1', [invitationId]);
	return result.rows[0]?.email ?? null;
}

/**
 * The SQL test that user `$n` may answer invitation `i`: their account's email is the
 * invited address and is verified. Accepting is joining the project, so an address the
 * account hasn't proven doesn't count.
 */
function addressedToSql(userParam: string): string {
	return `EXISTS (SELECT 1 FROM users me
		WHERE me.id = ${userParam} AND me.email_verified AND LOWER(me.email) = i.email)`;
}

/** Open, unexpired invitations addressed to the user, newest first. */
export async function listInvitationsForUser(userId: string): Promise<InvitationDetails[]> {
	const result = await query<DetailsRow>(
		`${DETAILS_SELECT}
		 WHERE ${OPEN_SQL} AND i.expires_at > NOW() AND ${addressedToSql('$1')}
		 ORDER BY i.created_at DESC`,
		[userId]
	);
	return result.rows.map(toDetails);
}

/**
 * The invitation with this id, in whatever state, when it is addressed to the user.
 * Null when there is no such invitation or it is someone else's: the two read the same.
 */
export async function getInvitationForUser(invitationId: string, userId: string): Promise<InvitationDetails | null> {
	const result = await query<DetailsRow>(`${DETAILS_SELECT} WHERE i.id = $1 AND ${addressedToSql('$2')}`, [invitationId, userId]);
	const row = result.rows[0];
	return row ? toDetails(row) : null;
}

/**
 * The newest open, unexpired invitation to the same address and project as this one,
 * other than itself: where to send a recipient whose link was revoked or expired because
 * the owner invited them again.
 */
export async function newerOpenInvitationId(invitationId: string): Promise<string | null> {
	const result = await query<{ id: string }>(
		`SELECT i.id FROM project_invitations i
		 JOIN project_invitations old ON old.id = $1
		 WHERE i.project_id = old.project_id AND i.email = old.email AND i.id <> old.id
			AND ${OPEN_SQL} AND i.expires_at > NOW()
		 ORDER BY i.created_at DESC
		 LIMIT 1`,
		[invitationId]
	);
	return result.rows[0]?.id ?? null;
}

/** Why an invitation can't be answered. */
export type InvitationRefusal =
	/**
	 * No invitation with that id, or it is addressed to an address the caller's account
	 * doesn't hold (verified): the two read the same.
	 */
	| { refused: 'not_found' }
	/** Already accepted, declined, revoked, or expired. */
	| { refused: 'closed'; state: Exclude<InvitationState, 'open'> }
	/** Accepting only: the caller owns the project, and the owner is never a member. */
	| { refused: 'owner' }
	/** Accepting only: the caller hasn't onboarded, and members are addressed by slug. */
	| { refused: 'no_slug' };

export type AcceptInvitationResult =
	| {
		invitation: InvitationDetails;
		/** The caller's granted role now: the invited one, or the one they already had. */
		role: MemberRole;
		/** They were a member before; their role was left as it was. */
		alreadyMember: boolean;
	}
	| InvitationRefusal;

export type DeclineInvitationResult = { invitation: InvitationDetails } | InvitationRefusal;

interface LockedInvitation {
	id: string;
	project_id: string;
	role: MemberRole;
	invited_by: string | null;
	state: InvitationState;
	owner_id: string;
	addressed: boolean;
	user_slug: string | null;
}

/**
 * Lock the invitation for the rest of the transaction and check the caller may answer
 * it. Someone else's invitation is not found, before its state is looked at, so a caller
 * learns nothing about it.
 */
async function lockForAnswer(
	client: pg.PoolClient,
	invitationId: string,
	userId: string
): Promise<LockedInvitation | InvitationRefusal> {
	const result = await client.query<LockedInvitation>(
		`SELECT i.id, i.project_id, i.role, i.invited_by, ${STATE_SQL} AS state, p.owner_id,
			${addressedToSql('$2')} AS addressed,
			(SELECT slug FROM users WHERE id = $2) AS user_slug
		 FROM project_invitations i
		 JOIN projects p ON p.id = i.project_id
		 WHERE i.id = $1
		 FOR UPDATE OF i`,
		[invitationId, userId]
	);
	const row = result.rows[0];
	if (!row?.addressed) return { refused: 'not_found' };
	if (row.state !== 'open') return { refused: 'closed', state: row.state };
	return row;
}

async function detailsById(client: pg.PoolClient, invitationId: string): Promise<InvitationDetails> {
	const result = await client.query<DetailsRow>(`${DETAILS_SELECT} WHERE i.id = $1`, [invitationId]);
	return toDetails(result.rows[0]!);
}

/**
 * Accept an invitation: add the caller to the project with the invited role and stamp
 * the invitation, in one transaction. A caller who is already a member keeps the role
 * they have (accepting an invite never changes an existing role; that is the owner's
 * call in the member list) and the invitation is still stamped accepted.
 */
export async function acceptInvitation(invitationId: string, userId: string): Promise<AcceptInvitationResult> {
	return transaction(async (client) => {
		// Share-lock the project first, the row createInvitation takes FOR NO KEY UPDATE. An
		// invite of this address then waits for the membership to commit and refuses it as
		// a member, instead of checking before it exists and leaving a member with an open
		// invitation. Project before invitation, the same order the invite path locks in.
		const project = await client.query<{ project_id: string }>(
			'SELECT project_id FROM project_invitations WHERE id = $1',
			[invitationId]
		);
		if (!project.rows[0]) return { refused: 'not_found' };
		await client.query('SELECT 1 FROM projects WHERE id = $1 FOR SHARE', [project.rows[0].project_id]);

		const locked = await lockForAnswer(client, invitationId, userId);
		if ('refused' in locked) return locked;
		if (locked.owner_id === userId) return { refused: 'owner' };
		if (!locked.user_slug) return { refused: 'no_slug' };

		const inserted = await client.query<{ role: MemberRole }>(
			`INSERT INTO project_members (project_id, user_id, role, added_by)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (project_id, user_id) DO NOTHING
			 RETURNING role`,
			[locked.project_id, userId, locked.role, locked.invited_by]
		);
		let role = inserted.rows[0]?.role;
		const alreadyMember = role === undefined;
		if (role === undefined) {
			const existing = await client.query<{ role: MemberRole }>(
				'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
				[locked.project_id, userId]
			);
			role = existing.rows[0]!.role;
		}

		await client.query('UPDATE project_invitations SET accepted_at = NOW() WHERE id = $1', [locked.id]);
		return { invitation: await detailsById(client, locked.id), role, alreadyMember };
	});
}

/** Decline an invitation. Nothing changes but the stamp; the owner sees it declined. */
export async function declineInvitation(invitationId: string, userId: string): Promise<DeclineInvitationResult> {
	return transaction(async (client) => {
		const locked = await lockForAnswer(client, invitationId, userId);
		if ('refused' in locked) return locked;

		await client.query('UPDATE project_invitations SET declined_at = NOW() WHERE id = $1', [locked.id]);
		return { invitation: await detailsById(client, locked.id) };
	});
}
