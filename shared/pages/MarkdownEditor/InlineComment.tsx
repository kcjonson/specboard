import type { JSX } from 'preact';
import type { Comment } from './types';
import styles from './InlineComment.module.css';

export interface InlineCommentProps {
	/** The comment to display */
	comment: Comment;
	/** Whether this comment is currently active/selected */
	isActive?: boolean;
	/** Called when the comment is clicked */
	onClick?: () => void;
	/** Vertical position from top of editor in pixels */
	top: number;
}

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffHours / 24);

	if (diffHours < 1) {
		return 'Just now';
	} else if (diffHours < 24) {
		return `${diffHours}h ago`;
	} else if (diffDays < 7) {
		return `${diffDays}d ago`;
	} else {
		return date.toLocaleDateString();
	}
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map(word => word[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
}

export function InlineComment({
	comment,
	isActive = false,
	onClick,
	top,
}: InlineCommentProps): JSX.Element {
	return (
		<div
			class={`${styles.container} ${isActive ? styles.active : ''}`}
			style={{ top: `${top}px` }}
			onClick={onClick}
		>
			<div class={styles.connector} />
			<div class={styles.card}>
				<div class={styles.header}>
					<div class={styles.avatar}>{getInitials(comment.author)}</div>
					<div class={styles.meta}>
						<span class={styles.author}>{comment.author}</span>
						<span class={styles.timestamp}>{formatTimestamp(comment.timestamp)}</span>
					</div>
				</div>
				<div class={styles.text}>{comment.text}</div>
				{comment.replies.length > 0 && (
					<div class={styles.replies}>
						{comment.replies.map(reply => (
							<div key={reply.id} class={styles.reply}>
								<div class={styles.replyHeader}>
									<span class={styles.replyAvatar}>{getInitials(reply.author)}</span>
									<span class={styles.replyAuthor}>{reply.author}</span>
									<span class={styles.replyTimestamp}>{formatTimestamp(reply.timestamp)}</span>
								</div>
								<div class={styles.replyText}>{reply.text}</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
