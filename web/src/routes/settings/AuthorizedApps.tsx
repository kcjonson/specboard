import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { type AuthorizationsCollection, type AuthorizationModel } from '@doc-platform/models';
import { Button, Icon } from '@doc-platform/ui';
import styles from './AuthorizedApps.module.css';

// Friendly names for clients
const CLIENT_NAMES: Record<string, string> = {
	'claude-code': 'Claude Code',
	'doc-platform-cli': 'Doc Platform CLI',
};

// Friendly descriptions for scopes
const SCOPE_LABELS: Record<string, string> = {
	'docs:read': 'Read docs',
	'docs:write': 'Write docs',
	'tasks:read': 'Read tasks',
	'tasks:write': 'Write tasks',
};

function formatRelativeTime(dateString: string | null): string {
	if (!dateString) return 'Never';

	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffMinutes < 1) return 'Just now';
	if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
	if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

	return date.toLocaleDateString();
}

function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

interface AuthorizedAppsProps {
	authorizations: AuthorizationsCollection;
}

export function AuthorizedApps({ authorizations }: AuthorizedAppsProps): JSX.Element {
	// Local state for revoke confirmation and errors
	const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
	const [revoking, setRevoking] = useState<string | null>(null);
	const [revokeError, setRevokeError] = useState<string | null>(null);

	const handleRevoke = async (auth: AuthorizationModel): Promise<void> => {
		setRevoking(auth.id);
		setRevokeError(null);
		try {
			await authorizations.remove(auth);
			setConfirmRevoke(null);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to revoke access';
			setRevokeError(message);
		} finally {
			setRevoking(null);
		}
	};

	return (
		<div class={styles.container}>
			<h2 class={styles.title}>Authorized Apps</h2>
			<p class={styles.description}>
				These applications have access to your account. You can revoke access at any time.
			</p>

			{revokeError && (
				<div class={styles.error}>{revokeError}</div>
			)}

			{authorizations.length === 0 ? (
				<div class={styles.empty}>
					No applications are currently authorized to access your account.
				</div>
			) : (
				<div class={styles.list}>
					{authorizations.map((auth) => (
						<div key={auth.id} class={styles.item}>
							<div class={styles.itemHeader}>
								<span class={styles.icon}><Icon name="robot" class="size-lg" /></span>
								<div class={styles.itemInfo}>
									<div class={styles.clientName}>
										{CLIENT_NAMES[auth.client_id] || auth.client_id}
									</div>
									<div class={styles.deviceName}>{auth.device_name}</div>
								</div>
							</div>

							<div class={styles.itemDetails}>
								<div class={styles.scopes}>
									{auth.scopes.map((scope) => (
										<span key={scope} class={styles.scope}>
											{SCOPE_LABELS[scope] || scope}
										</span>
									))}
								</div>
								<div class={styles.dates}>
									<span>Authorized {formatDate(auth.created_at)}</span>
									<span class={styles.separator}>•</span>
									<span>Last used {formatRelativeTime(auth.last_used_at)}</span>
								</div>
							</div>

							<div class={styles.itemActions}>
								{confirmRevoke === auth.id ? (
									<div class={styles.confirmRevoke}>
										<span class={styles.confirmText}>Revoke access?</span>
										<Button
											onClick={() => handleRevoke(auth)}
											class={styles.dangerButton}
											disabled={revoking === auth.id}
										>
											{revoking === auth.id ? 'Revoking...' : 'Yes, Revoke'}
										</Button>
										<Button
											onClick={() => setConfirmRevoke(null)}
											class={styles.ghostButton}
											disabled={revoking === auth.id}
										>
											Cancel
										</Button>
									</div>
								) : (
									<Button
										onClick={() => setConfirmRevoke(auth.id)}
										class={styles.ghostButton}
									>
										Revoke Access
									</Button>
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
