import { useState } from 'preact/hooks';
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
	/** Called when user submits a reply */
	onReply?: (commentId: string, replyText: string) => void;
	/** Called when user toggles resolved status */
	onToggleResolved?: (commentId: string) => void;
}

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle future timestamps
	if (diffMs < 0) {
		return date.toLocaleDateString();
	}

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
	if (!name || !name.trim()) {
		return '?';
	}
	return name
		.split(' ')
		.filter(word => word.length > 0)
		.map(word => word[0])
		.join('')
		.toUpperCase()
		.slice(0, 2) || '?';
}

export function InlineComment({
	comment,
	isActive = false,
	onClick,
	top,
	onReply,
	onToggleResolved,
}: InlineCommentProps): JSX.Element {
	const [showReplyInput, setShowReplyInput] = useState(false);
	const [replyText, setReplyText] = useState('');

	const handleKeyDown = (event: KeyboardEvent): void => {
		if (!onClick) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClick();
		}
	};

	const handleReplySubmit = (e: Event): void => {
		e.preventDefault();
		e.stopPropagation();
		if (replyText.trim() && onReply) {
			onReply(comment.id, replyText.trim());
			setReplyText('');
			setShowReplyInput(false);
		}
	};

	const handleReplyKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			setShowReplyInput(false);
			setReplyText('');
		}
	};

	const handleToggleResolved = (e: Event): void => {
		e.stopPropagation();
		if (onToggleResolved) {
			onToggleResolved(comment.id);
		}
	};

	const containerClasses =
		styles.container +
		(isActive ? ` ${styles.active}` : '') +
		(comment.resolved ? ` ${styles.resolved}` : '');

	return (
		<div
			class={containerClasses}
			style={{ top: `${top}px` }}
			onClick={onClick}
			role={onClick ? 'button' : undefined}
			tabIndex={onClick ? 0 : -1}
			onKeyDown={handleKeyDown}
		>
			<div class={styles.connector} />
			<div class={styles.card}>
				<div class={styles.header}>
					<div class={styles.avatar}>{getInitials(comment.author)}</div>
					<div class={styles.meta}>
						<span class={styles.author}>{comment.author}</span>
						<span class={styles.timestamp}>{formatTimestamp(comment.timestamp)}</span>
					</div>
					{onToggleResolved && (
						<button
							class={styles.resolveButton}
							onClick={handleToggleResolved}
							title={comment.resolved ? 'Reopen comment' : 'Resolve comment'}
							type="button"
						>
							{comment.resolved ? '↩' : '✓'}
						</button>
					)}
				</div>
				<div class={styles.text}>{comment.text}</div>
				{comment.resolved && (
					<div class={styles.resolvedBadge}>Resolved</div>
				)}
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
				{onReply && !comment.resolved && (
					<div class={styles.actions}>
						{showReplyInput ? (
							<form onSubmit={handleReplySubmit} class={styles.replyForm}>
								<textarea
									class={styles.replyInput}
									placeholder="Write a reply..."
									value={replyText}
									onInput={(e) => setReplyText((e.target as HTMLTextAreaElement).value)}
									onKeyDown={handleReplyKeyDown}
									rows={2}
									autoFocus
								/>
								<div class={styles.replyFormActions}>
									<button
										type="button"
										class={styles.cancelButton}
										onClick={(e) => {
											e.stopPropagation();
											setShowReplyInput(false);
											setReplyText('');
										}}
									>
										Cancel
									</button>
									<button
										type="submit"
										class={styles.submitButton}
										disabled={!replyText.trim()}
									>
										Reply
									</button>
								</div>
							</form>
						) : (
							<button
								class={styles.replyButton}
								onClick={(e) => {
									e.stopPropagation();
									setShowReplyInput(true);
								}}
								type="button"
							>
								Reply
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
