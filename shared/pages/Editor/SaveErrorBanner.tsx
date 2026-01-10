import type { JSX } from 'preact';
import { Button, Notice } from '@doc-platform/ui';
import styles from './SaveErrorBanner.module.css';

export interface SaveErrorBannerProps {
	message: string;
	retryCount: number;
	maxRetries: number;
	onRetry: () => void;
}

export function SaveErrorBanner({
	message,
	retryCount,
	maxRetries,
	onRetry,
}: SaveErrorBannerProps): JSX.Element {
	const willRetry = retryCount < maxRetries;

	return (
		<Notice variant="warning" class={styles.banner}>
			<div class={styles.content}>
				<strong>Changes saved locally</strong>
				<span class={styles.message}>
					{message}
					{willRetry && ` Retrying automatically...`}
				</span>
			</div>
			<Button onClick={onRetry} class="secondary size-sm">
				Retry Now
			</Button>
		</Notice>
	);
}
