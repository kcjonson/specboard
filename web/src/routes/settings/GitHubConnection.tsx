import { useState, useEffect, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@specboard/ui';
import { GitHubConnectionModel, useModel } from '@specboard/models';
import styles from './GitHubConnection.module.css';

function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

export function GitHubConnection(): JSX.Element {
	// Model handles fetching and state management
	const connection = useMemo(() => new GitHubConnectionModel(), []);
	useModel(connection);

	// Local UI state for confirmation dialog
	const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
	const [callbackError, setCallbackError] = useState<string | null>(null);

	// Check for URL params (success/error from OAuth callback)
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const githubConnected = params.get('github_connected');
		const githubError = params.get('github_error');

		if (githubConnected || githubError) {
			// Clean up URL
			const url = new URL(window.location.href);
			url.searchParams.delete('github_connected');
			url.searchParams.delete('github_error');
			window.history.replaceState({}, '', url.toString());

			if (githubError) {
				setCallbackError(decodeURIComponent(githubError));
			} else if (githubConnected) {
				// Refresh connection data after successful OAuth
				connection.fetch();
			}
		}
	}, [connection]);

	const handleDisconnect = async (): Promise<void> => {
		try {
			await connection.disconnect();
			setShowDisconnectConfirm(false);
		} catch {
			// Error is captured in connection.$meta.error
		}
	};

	// Combine model error with callback error
	const error = callbackError || (connection.$meta.error?.message ?? null);
	const loading = connection.$meta.working && !connection.connected;

	return (
		<div class={styles.container}>
			<h2 class={styles.title}>Connected Accounts</h2>
			<p class={styles.description}>
				Connect your GitHub account to link repositories to your projects.
			</p>

			{error && (
				<div class={styles.error} role="alert">
					{error}
					{callbackError && (
						<Button
							onClick={() => setCallbackError(null)}
							class={styles.dismissButton}
						>
							Dismiss
						</Button>
					)}
				</div>
			)}

			{loading ? (
				<div class={styles.loading}>Loading...</div>
			) : connection.connected ? (
				<div class={styles.connectedCard}>
					<div class={styles.accountInfo}>
						<span class={styles.icon}><Icon name="github" class="size-lg" /></span>
						<div class={styles.details}>
							<div class={styles.provider}>GitHub</div>
							<div class={styles.username}>@{connection.username}</div>
							{connection.connectedAt && (
								<div class={styles.connectedDate}>
									Connected {formatDate(connection.connectedAt)}
								</div>
							)}
						</div>
					</div>

					{showDisconnectConfirm ? (
						<div class={styles.confirmActions}>
							<span class={styles.confirmText}>Disconnect GitHub?</span>
							<Button
								onClick={handleDisconnect}
								class={styles.dangerButton}
								disabled={connection.$meta.working}
							>
								{connection.$meta.working ? 'Disconnecting...' : 'Yes, Disconnect'}
							</Button>
							<Button
								onClick={() => setShowDisconnectConfirm(false)}
								class={styles.ghostButton}
								disabled={connection.$meta.working}
							>
								Cancel
							</Button>
						</div>
					) : (
						<Button
							onClick={() => setShowDisconnectConfirm(true)}
							class={styles.ghostButton}
						>
							Disconnect
						</Button>
					)}
				</div>
			) : (
				<div class={styles.disconnectedCard}>
					<div class={styles.accountInfo}>
						<span class={styles.icon}><Icon name="github" class="size-lg" /></span>
						<div class={styles.details}>
							<div class={styles.provider}>GitHub</div>
							<div class={styles.notConnected}>Not connected</div>
						</div>
					</div>
					<Button
						onClick={() => connection.connect()}
						class={styles.primaryButton}
					>
						Connect GitHub
					</Button>
				</div>
			)}
		</div>
	);
}
