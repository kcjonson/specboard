import type { JSX } from 'preact';
import { Button, Notice } from '@specboard/ui';
import styles from './SaveErrorBanner.module.css';

export interface SaveErrorBannerProps {
	message: string;
	/** Another attempt is already scheduled. */
	retrying: boolean;
	/** Absent when retrying can't help (the server refused the write). */
	onRetry?: () => void;
}

export function SaveErrorBanner({
	message,
	retrying,
	onRetry,
}: SaveErrorBannerProps): JSX.Element {
	return (
		<Notice variant="warning" class={styles.banner}>
			<div class={styles.content}>
				<strong>Changes saved locally</strong>
				<span class={styles.message}>
					{message}
					{retrying && ' Retrying automatically...'}
				</span>
			</div>
			{onRetry && (
				<Button onClick={onRetry} class="secondary size-sm">
					Retry Now
				</Button>
			)}
		</Notice>
	);
}
