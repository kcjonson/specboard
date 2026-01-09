/* global TextDecoder, DOMException, localStorage */
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@doc-platform/ui';
import { ChatMessage } from './ChatMessage';
import styles from './ChatSidebar.module.css';

interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

interface ModelInfo {
	id: string;
	name: string;
	description: string;
	freeTier?: boolean;
}

interface ProviderModels {
	provider: string;
	providerDisplayName: string;
	models: ModelInfo[];
}

interface ChatSidebarProps {
	documentContent?: string;
	documentPath?: string;
}

// Throttle interval for streaming updates (ms)
const STREAMING_THROTTLE_MS = 50;

// LocalStorage key for persisting model selection
const MODEL_STORAGE_KEY = 'chat-selected-model';

/**
 * Parse a model selection string (format: "provider:modelId")
 */
function parseModelSelection(value: string): { provider: string; model: string } | null {
	const parts = value.split(':');
	if (parts.length !== 2) return null;
	return { provider: parts[0], model: parts[1] };
}

/**
 * Create a model selection string
 */
function createModelSelection(provider: string, model: string): string {
	return `${provider}:${model}`;
}

export function ChatSidebar({
	documentContent,
	documentPath,
}: ChatSidebarProps): JSX.Element {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState('');
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Model selection
	const [availableModels, setAvailableModels] = useState<ProviderModels[]>([]);
	const [selectedModel, setSelectedModel] = useState<string>('');
	const [modelsLoading, setModelsLoading] = useState(true);
	const [modelsError, setModelsError] = useState<string | null>(null);

	// Refs for throttled streaming updates
	const pendingContentRef = useRef('');
	const flushTimeoutRef = useRef<number | null>(null);
	const currentAssistantIdRef = useRef<string | null>(null);

	// AbortController for cancelling ongoing requests
	const abortControllerRef = useRef<AbortController | null>(null);

	// Load available models on mount
	useEffect(() => {
		async function loadModels(): Promise<void> {
			setModelsLoading(true);
			setModelsError(null);
			try {
				const response = await fetch('/api/chat/models', {
					credentials: 'include',
				});
				if (!response.ok) {
					throw new Error('Failed to load models');
				}
				const data = await response.json();
				setAvailableModels(data.models || []);

				// Try to restore saved model selection (localStorage may be unavailable in private browsing)
				let savedModel: string | null = null;
				try {
					savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
				} catch {
					// localStorage unavailable (private browsing) - ignore
				}

				if (savedModel && data.models?.length > 0) {
					// Verify saved model is still available
					const parsed = parseModelSelection(savedModel);
					if (parsed) {
						const providerModels = data.models.find((p: ProviderModels) => p.provider === parsed.provider);
						if (providerModels?.models.some((m: ModelInfo) => m.id === parsed.model)) {
							setSelectedModel(savedModel);
							return;
						}
					}
				}

				// Fall back to first available model
				if (data.models?.length > 0 && data.models[0].models?.length > 0) {
					const firstProvider = data.models[0];
					const firstModel = firstProvider.models[0];
					setSelectedModel(createModelSelection(firstProvider.provider, firstModel.id));
				}
			} catch (err) {
				console.error('Failed to load models:', err);
				setModelsError(err instanceof Error ? err.message : 'Failed to load models');
			} finally {
				setModelsLoading(false);
			}
		}
		loadModels();
	}, []);

	// Save model selection to localStorage when it changes
	useEffect(() => {
		if (selectedModel) {
			try {
				localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
			} catch {
				// localStorage unavailable (private browsing) - ignore
			}
		}
	}, [selectedModel]);

	// Auto-scroll to bottom only when message count changes (not on every content update)
	const messageCount = messages.length;
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messageCount]);

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Cleanup on unmount - abort any ongoing request
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
			if (flushTimeoutRef.current) {
				clearTimeout(flushTimeoutRef.current);
			}
		};
	}, []);

	// Flush pending streaming content to state
	const flushPendingContent = useCallback(() => {
		if (pendingContentRef.current && currentAssistantIdRef.current) {
			const contentToAdd = pendingContentRef.current;
			const assistantId = currentAssistantIdRef.current;
			pendingContentRef.current = '';

			setMessages(prev => {
				const updated = [...prev];
				const lastIndex = updated.findIndex(m => m.id === assistantId);
				if (lastIndex !== -1) {
					updated[lastIndex] = {
						...updated[lastIndex],
						content: updated[lastIndex].content + contentToAdd,
					};
				}
				return updated;
			});
		}
		flushTimeoutRef.current = null;
	}, []);

	const handleSubmit = async (): Promise<void> => {
		const trimmedInput = input.trim();
		if (!trimmedInput || isStreaming) return;

		// Parse selected model
		const modelSelection = parseModelSelection(selectedModel);
		if (!modelSelection) {
			setError('Please select an AI model');
			return;
		}

		setError(null);
		setInput('');

		// Add user message
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: trimmedInput,
		};
		setMessages(prev => [...prev, userMessage]);

		// Add placeholder for assistant response
		const assistantMessage: Message = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: '',
		};
		currentAssistantIdRef.current = assistantMessage.id;
		setMessages(prev => [...prev, assistantMessage]);
		setIsStreaming(true);

		// Create new AbortController for this request
		abortControllerRef.current = new AbortController();

		try {
			// Build conversation history (exclude the current messages)
			const conversationHistory = messages.map(m => ({
				role: m.role,
				content: m.content,
			}));

			// Get CSRF token from cookie
			const csrfToken = document.cookie
				.split('; ')
				.find(row => row.startsWith('csrf_token='))
				?.split('=')[1] || '';

			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-csrf-token': csrfToken,
				},
				body: JSON.stringify({
					message: trimmedInput,
					document_content: documentContent,
					document_path: documentPath,
					conversation_history: conversationHistory,
					provider: modelSelection.provider,
					model: modelSelection.model,
				}),
				signal: abortControllerRef.current.signal,
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const errorMsg = typeof errorData.error === 'string' ? errorData.error : `HTTP ${response.status}`;
				throw new Error(errorMsg);
			}

			// Read SSE stream
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE events from buffer
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						try {
							const parsed = JSON.parse(data);

							if ('text' in parsed) {
								// Delta event - accumulate text and throttle updates
								pendingContentRef.current += parsed.text;

								// Schedule flush if not already scheduled
								if (!flushTimeoutRef.current) {
									flushTimeoutRef.current = setTimeout(
										flushPendingContent,
										STREAMING_THROTTLE_MS
									);
								}
							} else if ('error' in parsed) {
								// Error event
								throw new Error(parsed.error);
							}
							// Done event - just finish streaming
						} catch (parseError) {
							// Ignore JSON parse errors for malformed data
							if (parseError instanceof SyntaxError) continue;
							throw parseError;
						}
					}
				}
			}

			// Final flush of any remaining content
			if (flushTimeoutRef.current) {
				clearTimeout(flushTimeoutRef.current);
				flushTimeoutRef.current = null;
			}
			flushPendingContent();
		} catch (err) {
			// Don't show error if request was aborted (user navigated away)
			if (
				(err instanceof Error && err.name === 'AbortError') ||
				(typeof DOMException !== 'undefined' && err instanceof DOMException && err.code === 20)
			) {
				return;
			}

			const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
			setError(errorMessage);

			// Remove the empty assistant message on error
			setMessages(prev => {
				if (prev[prev.length - 1]?.content === '') {
					return prev.slice(0, -1);
				}
				return prev;
			});

			// Return focus to input after error
			inputRef.current?.focus();
		} finally {
			setIsStreaming(false);
			currentAssistantIdRef.current = null;
			pendingContentRef.current = '';
		}
	};

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const handleModelChange = (e: Event): void => {
		const value = (e.target as HTMLSelectElement).value;
		setSelectedModel(value);
	};

	// Check if no models are available (no API keys configured vs API failure)
	const hasNoModels = !modelsLoading && !modelsError && availableModels.length === 0;
	const hasModelsError = !modelsLoading && modelsError !== null;

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
					<span class={styles.modelLoading}>Loading models...</span>
				) : hasModelsError ? (
					<span class={styles.modelLoading}>Failed to load models. Please refresh.</span>
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
						<Icon name="xmark" />
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
						<span class={styles.loadingDots}>...</span>
					) : (
						<Icon name="paper-plane" />
					)}
				</Button>
			</div>
		</div>
	);
}
