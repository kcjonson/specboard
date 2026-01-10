import type { JSX } from 'preact';
import { memo, useMemo, useState, useRef } from 'preact/compat';
import styles from './ChatSidebar.module.css';
import { parseAndMatchEdits, applyEdits, hasEditBlocks, type ParsedEdits } from './parseEdit';
import { EditCard } from './EditCard';

interface ChatMessageProps {
	role: 'user' | 'assistant';
	content: string;
	isStreaming?: boolean;
	currentDocument?: string;
	onApplyEdit?: (newMarkdown: string) => void;
}

/**
 * Chat message component - memoized to prevent unnecessary re-renders during streaming.
 * Only re-renders when its own props change, not when sibling messages update.
 */
export const ChatMessage = memo(function ChatMessage({
	role,
	content,
	isStreaming,
	currentDocument,
	onApplyEdit,
}: ChatMessageProps): JSX.Element {
	// Track whether the edit has been applied (persists across re-renders)
	const [isApplied, setIsApplied] = useState(false);

	// Store the original parsed edits so we can display them after applying
	// (after apply, currentDocument changes and the blocks won't match anymore)
	const appliedEditsRef = useRef<ParsedEdits | null>(null);

	// Parse edit blocks from assistant messages (even during streaming to avoid flash)
	const edits = useMemo(() => {
		// If already applied, use the stored edits
		if (isApplied && appliedEditsRef.current) {
			return appliedEditsRef.current;
		}
		if (role !== 'assistant' || !currentDocument || !hasEditBlocks(content)) {
			return null;
		}
		return parseAndMatchEdits(content, currentDocument);
	}, [role, content, currentDocument, isApplied]);

	const handleApply = (): void => {
		if (!edits || !currentDocument || !onApplyEdit) return;
		// Store the edits before applying (so we can still display the card)
		appliedEditsRef.current = edits;
		const newMarkdown = applyEdits(currentDocument, edits.blocks);
		onApplyEdit(newMarkdown);
		setIsApplied(true);
	};

	// Render message with edit blocks inline
	const renderContent = (): JSX.Element | JSX.Element[] => {
		if (!edits || edits.textSegments.length === 0) {
			return <>{content}</>;
		}

		// Find the first edit block index - we only render one EditCard for all edits
		const firstEditIndex = edits.textSegments.findIndex(
			(segment) => segment.type !== 'text'
		);

		return edits.textSegments.map((segment, index) => {
			if (segment.type === 'text') {
				return <span key={index}>{segment.content}</span>;
			}
			// Only render EditCard for the first edit block
			// (subsequent edit blocks are skipped - one card applies all edits)
			if (index !== firstEditIndex) {
				return null;
			}
			return (
				<EditCard
					key={index}
					stats={edits.stats}
					onApply={handleApply}
					isStreaming={isStreaming}
					isApplied={isApplied}
				/>
			);
		});
	};

	return (
		<div
			class={`${styles.message} ${styles[role]}`}
			role="article"
			aria-label={`${role === 'user' ? 'You' : 'AI assistant'} said`}
		>
			<div class={styles.messageContent}>
				{renderContent()}
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
