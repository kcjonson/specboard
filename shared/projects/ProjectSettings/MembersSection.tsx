import { useCallback, useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { fetchClient, FetchError } from '@specboard/fetch';
import { writeFailure } from '@specboard/models';
import { Avatar, Badge, Button, ConfirmDialog, Icon, Notice } from '@specboard/ui';
import { InviteDialog } from './InviteDialog';
import { expiryText, ROLE_LABELS, type Member, type MemberRole, type PendingInvitation } from './settings-api';
import styles from './ProjectSettings.module.css';

export interface MembersSectionProps {
	projectRef: string;
	projectName: string;
	/** Whether the caller owns the project: roles, removal and invitations are theirs alone. */
	isOwner: boolean;
	/** The connected repository as owner/repo, for the push-access chip; null without one. */
	repositoryName: string | null;
}

type Confirmation =
	| { kind: 'remove'; member: Member }
	| { kind: 'revoke'; invitation: PendingInvitation }
	| { kind: 'leave' };

/**
 * The owner and members. The owner changes roles, removes people and invites them; a
 * member sees the list read-only and can leave.
 */
export function MembersSection({ projectRef, projectName, isOwner, repositoryName }: MembersSectionProps): JSX.Element {
	const [members, setMembers] = useState<Member[] | null>(null);
	const [pending, setPending] = useState<PendingInvitation[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [status, setStatus] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
	// Rows with a request in flight, by member slug or invitation id.
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [inviting, setInviting] = useState(false);
	const [confirming, setConfirming] = useState<Confirmation | null>(null);

	const load = useCallback(async (): Promise<void> => {
		setLoadError(null);
		try {
			const [memberRows, invitationRows] = await Promise.all([
				fetchClient.get<Member[]>(`/api/projects/${projectRef}/members`),
				isOwner ? fetchClient.get<PendingInvitation[]>(`/api/projects/${projectRef}/invitations`) : Promise.resolve([]),
			]);
			setMembers(memberRows);
			setPending(invitationRows);
		} catch (err) {
			setLoadError(writeFailure(err, 'Couldn\'t load the members.', projectRef));
		}
	}, [projectRef, isOwner]);

	useEffect(() => {
		void load();
	}, [load]);

	/** Run one row's request, at most one at a time per row. */
	async function forRow(id: string, request: () => Promise<void>): Promise<void> {
		if (busy.has(id)) return;
		setBusy((ids) => new Set(ids).add(id));
		setStatus(null);
		try {
			await request();
		} finally {
			setBusy((ids) => {
				const next = new Set(ids);
				next.delete(id);
				return next;
			});
		}
	}

	function handleRoleChange(member: Member, role: MemberRole): Promise<void> {
		const slug = member.slug;
		if (!slug || role === member.role) return Promise.resolve();
		return forRow(slug, async () => {
			try {
				const updated = await fetchClient.put<Member>(`/api/projects/${projectRef}/members/${slug}`, { role });
				// The answer carries no push access; that doesn't change with the role.
				setMembers((rows) => rows?.map((row) => (row.slug === slug ? { ...row, ...updated, pushAccess: row.pushAccess } : row)) ?? null);
			} catch (err) {
				setStatus({ variant: 'error', text: writeFailure(err, `Couldn't change ${member.name}'s role.`, projectRef) });
			}
		});
	}

	function handleResend(invitation: PendingInvitation): Promise<void> {
		return forRow(invitation.id, async () => {
			try {
				const resent = await fetchClient.post<PendingInvitation>(`/api/projects/${projectRef}/invitations/${invitation.id}/resend`);
				setPending((rows) => rows.map((row) => (row.id === invitation.id ? resent : row)));
				setStatus({ variant: 'success', text: `Sent a new invitation to ${invitation.email}.` });
			} catch (err) {
				setStatus({ variant: 'error', text: writeFailure(err, `Couldn't resend the invitation to ${invitation.email}.`, projectRef) });
			}
		});
	}

	function handleInvited(invitation: PendingInvitation): void {
		setInviting(false);
		// Inviting an address that had an open invitation revokes the old one.
		setPending((rows) => [...rows.filter((row) => row.email !== invitation.email), invitation]);
		setStatus({ variant: 'success', text: `Invited ${invitation.email}.` });
	}

	async function leave(): Promise<void> {
		try {
			await fetchClient.delete(`/api/projects/${projectRef}/membership`);
		} catch (err) {
			// Already gone: removed by the owner, or the project deleted. Either way, out.
			if (!(err instanceof FetchError && err.status === 404)) throw err;
		}
		navigate('/projects');
	}

	async function handleConfirm(): Promise<void> {
		if (!confirming) return;
		try {
			if (confirming.kind === 'remove') {
				const { member } = confirming;
				await fetchClient.delete(`/api/projects/${projectRef}/members/${member.slug}`);
				setMembers((rows) => rows?.filter((row) => row.slug !== member.slug) ?? null);
			} else if (confirming.kind === 'revoke') {
				const { invitation } = confirming;
				await fetchClient.delete(`/api/projects/${projectRef}/invitations/${invitation.id}`);
				setPending((rows) => rows.filter((row) => row.id !== invitation.id));
			} else {
				await leave();
				return;
			}
		} catch (err) {
			throw new Error(writeFailure(err, 'That didn\'t work. Try again.', projectRef), { cause: err });
		}
		setConfirming(null);
	}

	const confirmProps = confirming?.kind === 'remove'
		? {
			title: `Remove ${confirming.member.name}?`,
			message: `${confirming.member.name} loses access to ${projectName} until you invite them again.`,
			confirmText: 'Remove',
			busyText: 'Removing...',
		}
		: confirming?.kind === 'revoke'
			? {
				title: 'Revoke invitation?',
				message: `The invitation to ${confirming.invitation.email} stops working.`,
				confirmText: 'Revoke',
				busyText: 'Revoking...',
			}
			: {
				title: `Leave ${projectName}?`,
				message: 'You lose access to the project until its owner invites you again.',
				confirmText: 'Leave project',
				busyText: 'Leaving...',
			};

	return (
		<div class={styles.form}>
			<div class={styles.sectionActions}>
				{isOwner ? (
					<Button onClick={() => setInviting(true)}>Invite</Button>
				) : (
					<Button class="secondary" onClick={() => setConfirming({ kind: 'leave' })}>Leave project</Button>
				)}
			</div>

			{loadError && (
				<Notice variant="error" announce>
					{loadError} <button type="button" class={styles.inlineLink} onClick={() => void load()}>Retry</button>
				</Notice>
			)}
			{status && <Notice variant={status.variant} announce>{status.text}</Notice>}

			{members && (
				<ul class={styles.memberList} aria-label="Members">
					{members.map((member) => (
						<MemberRow
							key={member.slug ?? member.email}
							member={member}
							isOwner={isOwner}
							repositoryName={repositoryName}
							busy={member.slug !== null && busy.has(member.slug)}
							onRoleChange={handleRoleChange}
							onRemove={() => setConfirming({ kind: 'remove', member })}
						/>
					))}
				</ul>
			)}

			{isOwner && pending.length > 0 && (
				<div class={styles.pending}>
					<h3 class={styles.subheading}>Pending</h3>
					<ul class={styles.memberList} aria-label="Pending invitations">
						{pending.map((invitation) => (
							<li key={invitation.id} class={styles.memberRow}>
								<div class={styles.memberIdentity}>
									<span class={styles.memberEmail}>{invitation.email}</span>
								</div>
								<span class={styles.memberRole}>{ROLE_LABELS[invitation.role]}</span>
								<span class={`${styles.expiry} ${invitation.state === 'expired' ? styles.expired : ''}`}>
									{expiryText(invitation)}
								</span>
								<div class={styles.rowActions}>
									<Button class="secondary size-sm" onClick={() => void handleResend(invitation)} busy={busy.has(invitation.id)}>
										{busy.has(invitation.id) ? 'Sending...' : 'Resend'}
									</Button>
									<Button class="text danger size-sm" onClick={() => setConfirming({ kind: 'revoke', invitation })}>
										Revoke
									</Button>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}

			{inviting && (
				<InviteDialog
					projectRef={projectRef}
					projectName={projectName}
					repositoryName={repositoryName}
					onClose={() => setInviting(false)}
					onInvited={handleInvited}
				/>
			)}

			<ConfirmDialog
				open={confirming !== null}
				{...confirmProps}
				onConfirm={handleConfirm}
				onCancel={() => setConfirming(null)}
			/>
		</div>
	);
}

interface MemberRowProps {
	member: Member;
	isOwner: boolean;
	repositoryName: string | null;
	busy: boolean;
	onRoleChange: (member: Member, role: MemberRole) => Promise<void>;
	onRemove: () => void;
}

function MemberRow({ member, isOwner, repositoryName, busy, onRoleChange, onRemove }: MemberRowProps): JSX.Element {
	const manageable = isOwner && member.role !== 'owner' && member.slug !== null;
	const needsGitHub = member.role === 'editor' && !member.githubConnected;
	const noPushAccess = member.pushAccess === false;
	// The role just picked, shown while it saves; a refused change falls back to the saved one.
	const [picked, setPicked] = useState<MemberRole | null>(null);

	return (
		<li class={styles.memberRow} aria-busy={busy || undefined}>
			<div class={styles.memberIdentity}>
				<Avatar name={member.name} avatarUrl={member.avatarUrl} size="md" decorative />
				<div class={styles.memberText}>
					<span class={styles.memberName}>{member.name}</span>
					<span class={styles.memberEmail}>{member.email}</span>
				</div>
			</div>
			{manageable ? (
				// Stays enabled while its change saves, so it keeps focus; forRow lets one
				// change per row run at a time.
				<select
					class={styles.roleSelect}
					value={picked ?? member.role}
					aria-label={`Role for ${member.name}`}
					aria-busy={busy || undefined}
					onChange={(e) => {
						const role = (e.target as HTMLSelectElement).value as MemberRole;
						setPicked(role);
						void onRoleChange(member, role).finally(() => setPicked(null));
					}}
				>
					<option value="editor">Editor</option>
					<option value="viewer">Viewer</option>
				</select>
			) : (
				<span class={styles.memberRole}>{ROLE_LABELS[member.role]}</span>
			)}
			<div class={styles.rowActions}>
				{manageable && (
					<button
						type="button"
						class="icon size-sm"
						onClick={onRemove}
						aria-label={`Remove ${member.name}`}
						title={`Remove ${member.name}`}
					>
						<Icon name="close" class="size-sm" />
					</button>
				)}
			</div>
			{isOwner && (needsGitHub || noPushAccess) && (
				<div class={styles.chips}>
					{needsGitHub && <Badge class="variant-warning size-sm">Needs GitHub to edit</Badge>}
					{noPushAccess && repositoryName && (
						<Badge class="variant-warning size-sm">No push access to {repositoryName}</Badge>
					)}
				</div>
			)}
		</li>
	);
}
