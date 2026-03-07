import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient, FetchError } from '@specboard/fetch';
import { Dialog, Button, Icon } from '@specboard/ui';
import type { SyncStatus } from '@specboard/models';
import styles from './SyncProgressDialog.module.css';

interface SyncStatusResponse {
	status: SyncStatus | null;
	error: string | null;
}

export interface SyncProgressDialogProps {
	projectId: string;
	projectName: string;
	onNavigate: (destination: 'planning' | 'pages') => void;
	onDismiss: () => void;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes at 3s intervals

/** Extract a user-friendly error message from a caught error */
function getErrorMessage(err: unknown): string {
	if (err instanceof FetchError && err.data) {
		const data = err.data as Record<string, unknown>;
		if (typeof data.error === 'string') return data.error;
	}
	if (err instanceof Error) return err.message;
	return 'An unexpected error occurred';
}

export function SyncProgressDialog({
	projectId,
	projectName,
	onNavigate,
	onDismiss,
}: SyncProgressDialogProps): JSX.Element {
	const [syncStatus, setSyncStatus] = useState<SyncStatus | null>('pending');
	const [syncError, setSyncError] = useState<string | null>(null);
	const [retrying, setRetrying] = useState(false);
	// Increment to restart the polling effect (e.g. after retry)
	const [pollGeneration, setPollGeneration] = useState(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	// Track mounted state for async handlers
	useEffect(() => {
		mountedRef.current = true;
		return () => { mountedRef.current = false; };
	}, []);

	useEffect(() => {
		let cancelled = false;
		let pollCount = 0;
		let consecutiveErrors = 0;

		async function poll(): Promise<void> {
			try {
				const data = await fetchClient.get<SyncStatusResponse>(
					`/api/projects/${projectId}/sync/status`
				);

				if (cancelled) return;

				consecutiveErrors = 0;
				setSyncStatus(data.status);
				setSyncError(data.error);

				// Continue polling while sync is in progress
				if (data.status === 'pending' || data.status === 'syncing') {
					pollCount++;
					if (pollCount < MAX_POLL_ATTEMPTS) {
						timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
					} else {
						setSyncError('Sync is taking longer than expected. Try closing this dialog and checking back later.');
						setSyncStatus('failed');
					}
				}
			} catch {
				if (cancelled) return;
				consecutiveErrors++;
				// Backoff on repeated errors: 3s, 6s, 9s... capped at 15s
				const backoff = Math.min(POLL_INTERVAL_MS * consecutiveErrors, 15000);
				timerRef.current = setTimeout(poll, backoff);
			}
		}

		poll();

		return () => {
			cancelled = true;
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, pollGeneration]);

	const handleRetry = async (): Promise<void> => {
		setRetrying(true);
		setSyncError(null);
		try {
			await fetchClient.post(`/api/projects/${projectId}/sync/initial`);
			if (!mountedRef.current) return;
			setSyncStatus('pending');
			// Restart polling by incrementing the generation counter
			setPollGeneration((g) => g + 1);
		} catch (err) {
			if (!mountedRef.current) return;
			setSyncError(getErrorMessage(err));
			setSyncStatus('failed');
		} finally {
			if (mountedRef.current) {
				setRetrying(false);
			}
		}
	};

	const isSyncing = syncStatus === 'pending' || syncStatus === 'syncing';
	const isCompleted = syncStatus === 'completed';
	const isFailed = syncStatus === 'failed';

	return (
		<Dialog onClose={onDismiss} title={`Setting up ${projectName}`} maxWidth="sm">
			<div class={styles.content} aria-live="polite">
				{isSyncing && (
					<>
						<div class={styles.spinner} role="status" aria-label="Syncing" />
						<div class={styles.title}>Syncing repository...</div>
						<div class={styles.hint}>
							Importing files from your repository. This may take a moment.
						</div>
						<button class={styles.dismissLink} onClick={onDismiss} type="button">
							Continue anyway
						</button>
					</>
				)}

				{isCompleted && (
					<>
						<div class={styles.stateIcon}>
							<Icon name="check" class="size-2xl" />
						</div>
						<div class={styles.title}>Sync complete</div>
						<div class={styles.hint}>
							Your repository has been imported successfully.
						</div>
						<div class={styles.actions}>
							<Button onClick={() => onNavigate('pages')}>
								Go to Pages
							</Button>
							<Button onClick={() => onNavigate('planning')}>
								Go to Planning
							</Button>
						</div>
					</>
				)}

				{isFailed && (
					<>
						<div class={`${styles.stateIcon} ${styles.stateIconError}`}>
							<Icon name="alert-circle" class="size-2xl" />
						</div>
						<div class={styles.title}>Sync failed</div>
						{syncError && (
							<div class={styles.errorMessage}>{syncError}</div>
						)}
						<div class={styles.actions}>
							<Button onClick={handleRetry} disabled={retrying}>
								{retrying ? 'Retrying...' : 'Retry Sync'}
							</Button>
							<Button onClick={onDismiss}>
								Continue anyway
							</Button>
						</div>
					</>
				)}
			</div>
		</Dialog>
	);
}
