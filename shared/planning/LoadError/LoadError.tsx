import { useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { FetchError } from '@specboard/fetch';
import { Button } from '@specboard/ui';
import styles from './LoadError.module.css';

export interface LoadErrorProps {
	error: Error;
	onRetry: () => void;
}

/**
 * A planning view that failed to load: the message and a Retry, or a Sign in when
 * the session has expired. Rendered where the view goes, so the toolbar stays put
 * and the user always has something to act on.
 */
export function LoadError({ error, onRetry }: LoadErrorProps): JSX.Element {
	const handleSignIn = useCallback((): void => {
		const next = window.location.pathname + window.location.search + window.location.hash;
		window.location.href = `/login?next=${encodeURIComponent(next)}`;
	}, []);

	if (error instanceof FetchError && error.status === 401) {
		return (
			<div class={styles.error} role="alert">
				<p>Your session has expired. Sign in to keep working.</p>
				<Button class="secondary" onClick={handleSignIn}>Sign in</Button>
			</div>
		);
	}
	return (
		<div class={styles.error} role="alert">
			<p>Error: {error.message}</p>
			<Button class="secondary" onClick={onRetry}>Retry</Button>
		</div>
	);
}
