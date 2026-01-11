/* global TextDecoder, DOMException */
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import type { RefObject } from 'preact';
import { parseModelSelection } from './useModelSelection';

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

// Throttle interval for streaming updates (ms)
const STREAMING_THROTTLE_MS = 50;

export interface UseChatStreamOptions {
	documentContent?: string;
	documentPath?: string;
	selectedModel: string;
	inputRef: RefObject<HTMLTextAreaElement>;
}

export interface UseChatStreamReturn {
	messages: Message[];
	input: string;
	setInput: (value: string) => void;
	isStreaming: boolean;
	error: string | null;
	setError: (error: string | null) => void;
	handleSubmit: () => Promise<void>;
	handleKeyDown: (e: KeyboardEvent) => void;
	messagesEndRef: RefObject<HTMLDivElement>;
}

/**
 * Hook for managing chat streaming with SSE
 */
export function useChatStream({
	documentContent,
	documentPath,
	selectedModel,
	inputRef,
}: UseChatStreamOptions): UseChatStreamReturn {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState('');
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Refs for throttled streaming updates
	const pendingContentRef = useRef('');
	const flushTimeoutRef = useRef<number | null>(null);
	const currentAssistantIdRef = useRef<string | null>(null);

	// AbortController for cancelling ongoing requests
	const abortControllerRef = useRef<AbortController | null>(null);

	// Auto-scroll to bottom only when message count changes (not on every content update)
	const messageCount = messages.length;
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messageCount]);

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, [inputRef]);

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
				const existingMsg = updated[lastIndex];
				if (lastIndex !== -1 && existingMsg) {
					updated[lastIndex] = {
						...existingMsg,
						content: existingMsg.content + contentToAdd,
					};
				}
				return updated;
			});
		}
		flushTimeoutRef.current = null;
	}, []);

	const handleSubmit = useCallback(async (): Promise<void> => {
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
									) as unknown as number;
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
	}, [input, isStreaming, selectedModel, messages, documentContent, documentPath, inputRef, flushPendingContent]);

	const handleKeyDown = useCallback((e: KeyboardEvent): void => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}, [handleSubmit]);

	return {
		messages,
		input,
		setInput,
		isStreaming,
		error,
		setError,
		handleSubmit,
		handleKeyDown,
		messagesEndRef,
	};
}
