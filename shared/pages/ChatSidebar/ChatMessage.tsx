import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import styles from './ChatSidebar.module.css';

interface ChatMessageProps {
	role: 'user' | 'assistant';
	content: string;
	isStreaming?: boolean;
}

/**
 * Chat message component - memoized to prevent unnecessary re-renders during streaming.
 * Only re-renders when its own props change, not when sibling messages update.
 */
export const ChatMessage = memo(function ChatMessage({
	role,
	content,
	isStreaming,
}: ChatMessageProps): JSX.Element {
	return (
		<div
			class={`${styles.message} ${styles[role]}`}
			role="article"
			aria-label={`${role === 'user' ? 'You' : 'AI assistant'} said`}
		>
			<div class={styles.messageContent}>
				{content}
				{isStreaming && (
					<>
						<span class={styles.cursor} aria-hidden="true">|</span>
						<span class={styles.srOnly}>AI is typing...</span>
					</>
				)}
			</div>
		</div>
	);
});
