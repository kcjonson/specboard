/**
 * AI Chat handler with SSE streaming
 *
 * Endpoint: POST /api/chat
 *
 * Supports multiple AI providers (Anthropic, Google Gemini).
 * Uses the user's own API key to stream responses.
 */

import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import { getProject } from '@specboard/db';
import { getDecryptedApiKey } from './api-keys.ts';
import { isValidProvider, getProvider, isValidModel, type ChatMessage } from '../providers/index.ts';
import { composeSystemPrompt } from '../prompts/index.ts';
import { readRepoConventions } from '../prompts/repo-conventions.ts';
import { isValidUUID } from '../validation.ts';

// Constants
const MAX_MESSAGE_LENGTH = 10000;
const MAX_DOCUMENT_LENGTH = 100000;
const MAX_HISTORY_LENGTH = 50;
const MAX_HISTORY_MESSAGE_LENGTH = 10000;
const STREAM_TIMEOUT_MS = 60000; // 60 second timeout for streaming

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
	const project_id = typeof req.project_id === 'string' ? req.project_id : undefined;
	const rawHistory = Array.isArray(req.conversation_history) ? req.conversation_history : [];

	// Validate project_id if provided
	if (project_id && !isValidUUID(project_id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	// Get provider and model from request (with defaults for backwards compatibility)
	const providerName = typeof req.provider === 'string' ? req.provider : 'anthropic';
	const modelId = typeof req.model === 'string' ? req.model : undefined;

	// Validate provider
	if (!isValidProvider(providerName)) {
		return context.json({ error: `Invalid provider: ${providerName}` }, 400);
	}

	const provider = getProvider(providerName);

	// Use default model if not specified
	const selectedModel = modelId || provider.config.defaultModel;

	// Validate model
	if (!isValidModel(providerName, selectedModel)) {
		return context.json({ error: `Invalid model: ${selectedModel} for provider ${providerName}` }, 400);
	}

	// Get user's API key for the provider
	const apiKey = await getDecryptedApiKey(session.userId, providerName);
	if (!apiKey) {
		return context.json(
			{ error: `No ${provider.config.displayName} API key configured. Please add one in Settings → API Keys.` },
			400
		);
	}

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

	// Validate conversation history (leave room for current message)
	if (rawHistory.length >= MAX_HISTORY_LENGTH) {
		return context.json({ error: `Conversation history too long (max ${MAX_HISTORY_LENGTH - 1} messages)` }, 400);
	}

	const conversation_history: ChatMessage[] = [];
	for (const msg of rawHistory) {
		if (!isValidChatMessage(msg)) {
			return context.json({ error: 'Invalid message in conversation history' }, 400);
		}
		conversation_history.push(msg);
	}

	// Fetch project data if project_id is provided
	let projectPrompt: string | undefined;
	let repoConventions: string | null = null;
	if (project_id) {
		const project = await getProject(project_id, session.userId);
		if (project) {
			if (project.systemPrompt) {
				projectPrompt = project.systemPrompt;
			}
			repoConventions = await readRepoConventions(project_id, session.userId, redis);
		}
	}

	// Build messages array
	let systemPrompt: string;
	try {
		systemPrompt = composeSystemPrompt({
			documentPath: document_path,
			documentContent: document_content,
			projectPrompt,
			repoConventions: repoConventions ?? undefined,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to compose system prompt';
		return context.json({ error: message }, 400);
	}
	const messages: ChatMessage[] = [
		...conversation_history,
		{ role: 'user', content: message },
	];

	// Return SSE stream using the provider with timeout and abort support
	return streamSSE(context, async (stream) => {
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, STREAM_TIMEOUT_MS);

		try {
			await provider.streamChat(stream, apiKey, selectedModel, systemPrompt, messages, abortController.signal);
		} catch (error) {
			// Check if this was an abort (timeout)
			if (error instanceof Error && error.name === 'AbortError') {
				await stream.writeSSE({
					event: 'error',
					data: JSON.stringify({ error: 'Request timed out. Please try again.' }),
				});
			}
			// Other errors are already handled by the provider
		} finally {
			clearTimeout(timeoutId);
		}
	});
}
