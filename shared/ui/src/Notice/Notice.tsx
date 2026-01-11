import type { JSX, ComponentChildren } from 'preact';
import styles from './Notice.module.css';

/**
 * Notice variants represent different levels of user attention required.
 *
 * Use the appropriate variant based on the urgency and nature of the message:
 *
 * - **trivial**: Minimal attention needed. For confirmations of routine actions
 *   that don't require user response. Example: "Preferences saved"
 *
 * - **info**: Neutral information. For context or status that helps the user
 *   but doesn't require action. Example: "Last edited 2 hours ago"
 *
 * - **success**: Positive confirmation. For successful completion of meaningful
 *   actions. Example: "Changes published successfully"
 *
 * - **warning**: Attention needed. For situations that may require user action
 *   or awareness but aren't failures. Example: "You have unsaved changes"
 *
 * - **error**: Something failed. For errors that prevented an action from
 *   completing. Example: "Failed to save - retrying..."
 */
export type NoticeVariant = 'trivial' | 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps {
	/** Content to display in the notice */
	children: ComponentChildren;
	/** Attention level - determines color and visual weight */
	variant?: NoticeVariant;
	/** Additional CSS classes */
	class?: string;
}

/**
 * Notice component for displaying messages that require user attention.
 *
 * Notices are used to communicate status, feedback, or important information.
 * Choose the variant based on how much attention the message requires, not
 * just the "type" of message.
 *
 * @example
 * // Routine confirmation - minimal attention
 * <Notice variant="trivial">Settings updated</Notice>
 *
 * @example
 * // Helpful context - some attention
 * <Notice variant="info">This document is shared with 3 people</Notice>
 *
 * @example
 * // Positive outcome - moderate attention
 * <Notice variant="success">Changes saved successfully</Notice>
 *
 * @example
 * // Needs awareness - elevated attention
 * <Notice variant="warning">You have unsaved changes</Notice>
 *
 * @example
 * // Something broke - high attention
 * <Notice variant="error">Failed to save. Retrying...</Notice>
 */
export function Notice({
	children,
	variant = 'info',
	class: className,
}: NoticeProps): JSX.Element {
	return (
		<div class={`${styles.notice} ${styles[variant]} ${className || ''}`}>
			{children}
		</div>
	);
}
