/**
 * AI Chat handler with SSE streaming
 *
 * Endpoint: POST /api/chat
 *
 * Uses the user's own Anthropic API key to stream Claude responses.
 */

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { getDecryptedApiKey } from './api-keys.js';

// Constants
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_MESSAGE_LENGTH = 10000;
const MAX_DOCUMENT_LENGTH = 100000;
const MAX_HISTORY_LENGTH = 50;
const MAX_HISTORY_MESSAGE_LENGTH = 10000;

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * Sanitize error messages to avoid leaking sensitive information
 */
function getSafeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg.includes('401') || msg.includes('invalid') || msg.includes('authentication')) {
			return 'API key configuration error. Please check your API key in Settings.';
		}
		if (msg.includes('rate') || msg.includes('429') || msg.includes('limit')) {
			return 'Rate limit exceeded. Please try again later.';
		}
		if (msg.includes('insufficient') || msg.includes('credit') || msg.includes('balance')) {
			return 'Insufficient API credits. Please check your Anthropic account.';
		}
	}
	return 'An error occurred while processing your request.';
}

/**
 * Validate a single chat message from conversation history
 */
function isValidChatMessage(msg: unknown): msg is ChatMessage {
	if (!msg || typeof msg !== 'object') return false;
	const m = msg as Record<string, unknown>;
	return (
		(m.role === 'user' || m.role === 'assistant') &&
		typeof m.content === 'string' &&
		m.content.length <= MAX_HISTORY_MESSAGE_LENGTH
	);
}

/**
 * Build the system prompt for document assistance
 */
function buildSystemPrompt(documentPath?: string, documentContent?: string): string {
	let prompt = `You are a helpful AI writing assistant integrated into a document editor.
Your role is to help users with their documents - answering questions, suggesting improvements,
helping with structure, fixing grammar, and providing relevant information.

Keep your responses concise and focused on being helpful with the document at hand.
Use markdown formatting when appropriate.`;

	if (documentPath && documentContent) {
		prompt += `

The user is currently working on a document. Here are the details:

**Document Path:** ${documentPath}

**Document Content:**
\`\`\`markdown
${documentContent}
\`\`\`

Consider this document context when answering questions and providing suggestions.`;
	}

	return prompt;
}

/**
 * Handle chat request with SSE streaming
 * POST /api/chat
 */
export async function handleChat(
	context: Context,
	redis: Redis
): Promise<Response> {
	// Validate session
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const session = await getSession(redis, sessionId);
	if (!session) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	// Get user's Anthropic API key
	const apiKey = await getDecryptedApiKey(session.userId, 'anthropic');
	if (!apiKey) {
		return context.json(
			{ error: 'No Anthropic API key configured. Please add one in Settings → API Keys.' },
			400
		);
	}

	// Parse request body with runtime validation
	let body: unknown;
	try {
		body = await context.req.json();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	// Validate request structure
	if (!body || typeof body !== 'object') {
		return context.json({ error: 'Invalid request body' }, 400);
	}

	const req = body as Record<string, unknown>;
	const message = typeof req.message === 'string' ? req.message : '';
	const document_content = typeof req.document_content === 'string' ? req.document_content : undefined;
	const document_path = typeof req.document_path === 'string' ? req.document_path : undefined;
	const rawHistory = Array.isArray(req.conversation_history) ? req.conversation_history : [];

	// Validate message
	if (!message || message.trim().length === 0) {
		return context.json({ error: 'Message is required' }, 400);
	}

	if (message.length > MAX_MESSAGE_LENGTH) {
		return context.json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }, 400);
	}

	// Validate document content
	if (document_content && document_content.length > MAX_DOCUMENT_LENGTH) {
		return context.json({ error: `Document too large (max ${MAX_DOCUMENT_LENGTH} characters)` }, 400);
	}

	// Validate conversation history
	if (rawHistory.length > MAX_HISTORY_LENGTH) {
		return context.json({ error: `Conversation history too long (max ${MAX_HISTORY_LENGTH} messages)` }, 400);
	}

	const conversation_history: ChatMessage[] = [];
	for (const msg of rawHistory) {
		if (!isValidChatMessage(msg)) {
			return context.json({ error: 'Invalid message in conversation history' }, 400);
		}
		conversation_history.push(msg);
	}

	// Build messages array for Claude
	const systemPrompt = buildSystemPrompt(document_path, document_content);
	const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
		...conversation_history,
		{ role: 'user', content: message },
	];

	// Create Anthropic client with user's API key
	const client = new Anthropic({ apiKey });

	// Return SSE stream
	return streamSSE(context, async (stream) => {
		try {
			// Create streaming message
			const response = await client.messages.create({
				model: CLAUDE_MODEL,
				max_tokens: 4096,
				system: systemPrompt,
				messages,
				stream: true,
			});

			let inputTokens = 0;
			let outputTokens = 0;

			// Process stream events
			for await (const event of response) {
				if (event.type === 'content_block_delta') {
					const delta = event.delta;
					if ('text' in delta) {
						await stream.writeSSE({
							event: 'delta',
							data: JSON.stringify({ text: delta.text }),
						});
					}
				} else if (event.type === 'message_delta') {
					if ('usage' in event) {
						outputTokens = event.usage.output_tokens;
					}
				} else if (event.type === 'message_start') {
					if ('usage' in event.message) {
						inputTokens = event.message.usage.input_tokens;
					}
				}
			}

			// Send completion event with usage stats
			await stream.writeSSE({
				event: 'done',
				data: JSON.stringify({
					usage: {
						input_tokens: inputTokens,
						output_tokens: outputTokens,
					},
				}),
			});
		} catch (error) {
			// Log full error for debugging (server-side only)
			console.error('Chat error:', {
				userId: session.userId,
				error: error instanceof Error ? error.message : 'Unknown error',
			});

			// Send sanitized error to client
			await stream.writeSSE({
				event: 'error',
				data: JSON.stringify({ error: getSafeErrorMessage(error) }),
			});
		}
	});
}
