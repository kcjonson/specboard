/* global TextDecoder */
/**
 * Google Gemini provider implementation
 *
 * Implements ChatProvider interface for Gemini models.
 * Uses REST API directly (no SDK required).
 */

import type { SSEStreamingApi } from 'hono/streaming';
import type { ChatProvider, ProviderConfig, ChatMessage } from './types.js';
import { getSafeErrorMessage } from './utils.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Convert our message format to Gemini's format
 */
function toGeminiMessages(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
	return messages.map(m => ({
		role: m.role === 'assistant' ? 'model' : 'user',
		parts: [{ text: m.content }],
	}));
}

export class GeminiProvider implements ChatProvider {
	readonly config: ProviderConfig = {
		name: 'gemini',
		displayName: 'Google Gemini',
		description: 'Gemini AI models (free tier available)',
		keyPrefix: 'AIza',
		keyPlaceholder: 'AIza...',
		consoleUrl: 'https://aistudio.google.com/app/apikey',
		models: [
			// Pro models - paid only
			{
				id: 'gemini-2.5-pro',
				name: 'Gemini 2.5 Pro',
				description: 'Most capable, complex reasoning',
				maxTokens: 8192,
				freeTier: false,
			},
			// Flash models - free tier available
			{
				id: 'gemini-2.5-flash',
				name: 'Gemini 2.5 Flash',
				description: 'Fast and capable',
				maxTokens: 8192,
				freeTier: true,
			},
			{
				id: 'gemini-2.0-flash',
				name: 'Gemini 2.0 Flash',
				description: 'Previous generation flash',
				maxTokens: 8192,
				freeTier: true,
			},
			{
				id: 'gemini-2.0-flash-lite',
				name: 'Gemini 2.0 Flash Lite',
				description: 'Lightweight, fastest responses',
				maxTokens: 8192,
				freeTier: true,
			},
		],
		defaultModel: 'gemini-2.5-flash',
	};

	validateKeyFormat(key: string): boolean {
		// Gemini API keys typically start with "AIza"
		return key.startsWith('AIza');
	}

	async validateKey(key: string): Promise<boolean> {
		try {
			// Make a minimal request to check if the key is valid
			const response = await fetch(
				`${GEMINI_API_URL}/models/gemini-2.5-flash:generateContent`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': key,
					},
					body: JSON.stringify({
						contents: [{ parts: [{ text: 'hi' }] }],
						generationConfig: { maxOutputTokens: 1 },
					}),
				}
			);

			// 200 = valid key
			// 400/401/403 = invalid key or permissions issue
			if (response.status === 401 || response.status === 403) {
				return false;
			}

			return true;
		} catch {
			// Network error - can't validate, but key might be valid
			return true;
		}
	}

	async streamChat(
		stream: SSEStreamingApi,
		apiKey: string,
		modelId: string,
		systemPrompt: string,
		messages: ChatMessage[],
		signal?: AbortSignal
	): Promise<void> {
		try {
			const response = await fetch(
				`${GEMINI_API_URL}/models/${modelId}:streamGenerateContent?alt=sse`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': apiKey,
					},
					body: JSON.stringify({
						systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
						contents: toGeminiMessages(messages),
						generationConfig: {
							maxOutputTokens: 4096,
						},
					}),
					signal,
				}
			);

			if (!response.ok) {
				// Read error body to understand the actual error
				let errorDetail = '';
				try {
					const errorBody = await response.json();
					console.error('Gemini API error response:', JSON.stringify(errorBody, null, 2));
					// Gemini errors typically have error.message or error.status
					if (errorBody.error?.message) {
						errorDetail = errorBody.error.message;
					} else if (errorBody.error?.status) {
						errorDetail = errorBody.error.status;
					}
				} catch {
					// Couldn't parse error body
				}

				// Include detail for error classification, but status code for logging
				const errorMsg = errorDetail || `HTTP ${response.status}`;
				console.error('Gemini error:', response.status, errorMsg);
				throw new Error(`Gemini API error: ${errorMsg}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body');
			}

			const decoder = new TextDecoder();
			let buffer = '';
			let totalInputTokens = 0;
			let totalOutputTokens = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE events from buffer
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data);

							// Check for error in stream
							if (parsed.error) {
								console.error('Gemini stream error:', JSON.stringify(parsed.error, null, 2));
								throw new Error(parsed.error.message || parsed.error.status || 'Stream error');
							}

							// Extract text from candidates
							if (parsed.candidates?.[0]?.content?.parts) {
								for (const part of parsed.candidates[0].content.parts) {
									if (part.text) {
										await stream.writeSSE({
											event: 'delta',
											data: JSON.stringify({ text: part.text }),
										});
									}
								}
							}

							// Extract usage metadata
							if (parsed.usageMetadata) {
								totalInputTokens = parsed.usageMetadata.promptTokenCount || 0;
								totalOutputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
							}
						} catch {
							// Ignore JSON parse errors for malformed data
						}
					}
				}
			}

			// Flush the TextDecoder to handle any remaining bytes
			decoder.decode();

			// Send completion event
			await stream.writeSSE({
				event: 'done',
				data: JSON.stringify({
					usage: {
						input_tokens: totalInputTokens,
						output_tokens: totalOutputTokens,
					},
				}),
			});
		} catch (error) {
			// Log error for debugging (in production, use structured logging)
			console.error('Gemini streaming error:', error);
			await stream.writeSSE({
				event: 'error',
				data: JSON.stringify({ error: getSafeErrorMessage(error) }),
			});
		}
	}
}
