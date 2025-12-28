import { useEffect, useState, useRef } from 'preact/hooks';
import type { JSX, RefObject } from 'preact';
import type { Comment } from './types';
import { InlineComment } from './InlineComment';
import styles from './CommentsMargin.module.css';

export interface CommentPosition {
	commentId: string;
	top: number;
}

export interface CommentsMarginProps {
	/** Comments to display */
	comments: Comment[];
	/** Ref to the editor container to find comment highlights */
	editorRef: RefObject<HTMLDivElement>;
	/** Currently active/selected comment ID */
	activeCommentId?: string;
	/** Called when a comment is clicked */
	onCommentClick?: (commentId: string) => void;
}

/**
 * CommentsMargin positions comments in a margin to the right of the editor,
 * aligned with their corresponding highlighted text.
 */
export function CommentsMargin({
	comments,
	editorRef,
	activeCommentId,
	onCommentClick,
}: CommentsMarginProps): JSX.Element {
	const [positions, setPositions] = useState<CommentPosition[]>([]);
	const containerRef = useRef<HTMLDivElement>(null);

	// Calculate positions for each comment based on highlighted text positions
	useEffect(() => {
		function updatePositions(): void {
			const editor = editorRef.current;
			const container = containerRef.current;
			if (!editor || !container) return;

			const newPositions: CommentPosition[] = [];
			const containerRect = container.getBoundingClientRect();

			// Find all comment highlights and calculate their positions
			comments.forEach(comment => {
				const highlight = editor.querySelector(`[data-comment-id="${comment.id}"]`);
				if (highlight) {
					const highlightRect = highlight.getBoundingClientRect();
					// Position relative to the comments margin container
					const top = highlightRect.top - containerRect.top;
					newPositions.push({
						commentId: comment.id,
						top: Math.max(0, top),
					});
				}
			});

			// Resolve overlapping comments by stacking them
			// Sort by top position first
			newPositions.sort((a, b) => a.top - b.top);

			// Minimum gap between comments (approximate card height + gap)
			const minGap = 120;
			for (let i = 1; i < newPositions.length; i++) {
				const prev = newPositions[i - 1]!;
				const curr = newPositions[i]!;
				if (curr.top < prev.top + minGap) {
					curr.top = prev.top + minGap;
				}
			}

			setPositions(newPositions);
		}

		// Update positions initially
		updatePositions();

		// Update on scroll and resize
		const editor = editorRef.current;
		const scrollContainer = editor?.closest('[class*="editorWrapper"]');

		if (scrollContainer) {
			scrollContainer.addEventListener('scroll', updatePositions);
		}
		window.addEventListener('resize', updatePositions);

		// Also observe DOM changes in case content changes
		const observer = new MutationObserver(updatePositions);
		if (editor) {
			observer.observe(editor, { childList: true, subtree: true, characterData: true });
		}

		return () => {
			if (scrollContainer) {
				scrollContainer.removeEventListener('scroll', updatePositions);
			}
			window.removeEventListener('resize', updatePositions);
			observer.disconnect();
		};
	}, [comments, editorRef]);

	function handleCommentClick(commentId: string): void {
		if (onCommentClick) {
			onCommentClick(commentId);
		}

		// Scroll the highlighted text into view
		const editor = editorRef.current;
		if (editor) {
			const highlight = editor.querySelector(`[data-comment-id="${commentId}"]`);
			if (highlight) {
				highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	}

	return (
		<div ref={containerRef} class={styles.container}>
			{comments.map(comment => {
				const position = positions.find(p => p.commentId === comment.id);
				if (!position) return null;

				return (
					<InlineComment
						key={comment.id}
						comment={comment}
						top={position.top}
						isActive={activeCommentId === comment.id}
						onClick={() => handleCommentClick(comment.id)}
					/>
				);
			})}
		</div>
	);
}
