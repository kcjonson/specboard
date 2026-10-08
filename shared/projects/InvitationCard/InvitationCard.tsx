import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Avatar, Button, Card } from '@specboard/ui';
import styles from './InvitationCard.module.css';

/** One of the signed-in user's open invitations, as GET /api/invitations lists it. */
export interface Invitation {
	id: string;
	role: 'editor' | 'viewer';
	project: { ref: string; name: string };
	ownerName: string;
	inviterName: string;
	createdAt: string;
	expiresAt: string;
}

export interface InvitationCardProps {
	invitation: Invitation;
	/** Accept it. A rejection's message is shown on the card. */
	onAccept: (invitation: Invitation) => Promise<void>;
	/** Decline it. A rejection's message is shown on the card. */
	onDecline: (invitation: Invitation) => Promise<void>;
}

const ROLE_LABELS: Record<Invitation['role'], string> = { editor: 'Editor', viewer: 'Viewer' };

export function InvitationCard({ invitation, onAccept, onDecline }: InvitationCardProps): JSX.Element {
	const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function answer(action: 'accept' | 'decline'): Promise<void> {
		if (busy) return;
		setBusy(action);
		setError(null);
		try {
			await (action === 'accept' ? onAccept : onDecline)(invitation);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'That didn\'t work. Try again.');
			setBusy(null);
		}
	}

	return (
		<Card class={styles.card}>
			<div class={styles.body}>
				<Avatar name={invitation.inviterName} size="md" decorative />
				<p class={styles.text}>
					<strong>{invitation.inviterName}</strong> invited you to <strong>{invitation.project.name}</strong> as{' '}
					{ROLE_LABELS[invitation.role]}
				</p>
			</div>
			{error && <p class={styles.error} role="alert">{error}</p>}
			<div class={styles.actions}>
				<Button
					class="secondary size-sm"
					onClick={() => answer('decline')}
					busy={busy !== null}
					aria-label={`Decline the invitation to ${invitation.project.name}`}
				>
					{busy === 'decline' ? 'Declining...' : 'Decline'}
				</Button>
				<Button
					class="size-sm"
					onClick={() => answer('accept')}
					busy={busy !== null}
					aria-label={`Accept the invitation to ${invitation.project.name}`}
				>
					{busy === 'accept' ? 'Accepting...' : 'Accept'}
				</Button>
			</div>
		</Card>
	);
}
