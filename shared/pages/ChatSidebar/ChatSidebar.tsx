import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@doc-platform/ui';
import { ChatMessage } from './ChatMessage';
import {
	useModelSelection,
	useChatStream,
	createModelSelection,
} from './hooks';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
	documentContent?: string;
	documentPath?: string;
	onApplyEdit?: (newMarkdown: string) => void;
}

export function ChatSidebar({
	documentContent,
	documentPath,
	onApplyEdit,
}: ChatSidebarProps): JSX.Element {
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Model selection state
	const {
		availableModels,
		selectedModel,
		modelsLoading,
		hasNoModels,
		hasModelsError,
		handleModelChange,
	} = useModelSelection();

	// Chat streaming state
	const {
		messages,
		input,
		setInput,
		isStreaming,
		error,
		setError,
		handleSubmit,
		handleKeyDown,
		messagesEndRef,
	} = useChatStream({
		documentContent,
		documentPath,
		selectedModel,
		inputRef,
	});

	return (
		<div
			class={styles.sidebar}
			id="ai-chat-sidebar"
			role="complementary"
			aria-label="AI Chat"
		>
			<div class={styles.header}>
				<h3 class={styles.title}>
					<Icon name="comment" class="size-md" />
					AI Chat
				</h3>
			</div>

			{/* Model selector */}
			<div class={styles.modelSelector}>
				{modelsLoading ? (
					<span class={styles.modelLoading} role="status">Loading models...</span>
				) : hasModelsError ? (
					<span class={styles.modelLoading} role="alert">Failed to load models. Please refresh.</span>
				) : hasNoModels ? (
					<a href="/settings" class={styles.configureLink}>
						Configure API keys in Settings
					</a>
				) : (
					<select
						class={styles.modelSelect}
						value={selectedModel}
						onChange={handleModelChange}
						disabled={isStreaming}
						aria-label="Select AI model"
					>
						{availableModels.map(provider => (
							<optgroup key={provider.provider} label={provider.providerDisplayName}>
								{provider.models.map(model => (
									<option
										key={model.id}
										value={createModelSelection(provider.provider, model.id)}
									>
										{model.name}{model.freeTier ? ' (Free)' : ''}
									</option>
								))}
							</optgroup>
						))}
					</select>
				)}
			</div>

			<div
				class={styles.messages}
				role="log"
				aria-live="polite"
				aria-label="Chat messages"
			>
				{messages.length === 0 ? (
					<div class={styles.emptyState}>
						<p>Ask questions about your document or get writing assistance.</p>
						<div class={styles.suggestions}>
							<button
								class={styles.suggestion}
								onClick={() => setInput('Summarize this document')}
							>
								Summarize this document
							</button>
							<button
								class={styles.suggestion}
								onClick={() => setInput('Suggest improvements')}
							>
								Suggest improvements
							</button>
							<button
								class={styles.suggestion}
								onClick={() => setInput('Check for grammar issues')}
							>
								Check for grammar issues
							</button>
						</div>
					</div>
				) : (
					messages.map((message, index) => (
						<ChatMessage
							key={message.id}
							role={message.role}
							content={message.content}
							isStreaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'}
							currentDocument={documentContent}
							onApplyEdit={onApplyEdit}
						/>
					))
				)}
				<div ref={messagesEndRef} />
			</div>

			{error && (
				<div id="chat-error" class={styles.error} role="alert">
					{error}
					<button
						class={styles.dismissError}
						onClick={() => setError(null)}
						aria-label="Dismiss error"
					>
						<Icon name="x-mark" />
					</button>
				</div>
			)}

			<div class={styles.inputArea} aria-busy={isStreaming}>
				<textarea
					ref={inputRef}
					class={styles.input}
					placeholder="Ask about your document..."
					value={input}
					onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
					onKeyDown={handleKeyDown}
					disabled={isStreaming || hasNoModels || hasModelsError}
					rows={2}
					aria-describedby={error ? 'chat-error' : undefined}
					aria-invalid={!!error}
				/>
				<Button
					onClick={handleSubmit}
					disabled={!input.trim() || isStreaming || hasNoModels || hasModelsError}
					class={styles.sendButton}
					aria-label={isStreaming ? 'Sending message' : 'Send message'}
				>
					{isStreaming ? (
						<span class={styles.loadingDots} role="status" aria-label="Sending">...</span>
					) : (
						<Icon name="paper-plane" />
					)}
				</Button>
			</div>
		</div>
	);
}
