/**
 * Anthropic provider implementation
 *
 * Implements ChatProvider interface for Claude models.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';
import type { ChatProvider, ProviderConfig, ChatMessage } from './types.js';
import { getSafeErrorMessage } from './utils.js';

export class AnthropicProvider implements ChatProvider {
	readonly config: ProviderConfig = {
		name: 'anthropic',
		displayName: 'Anthropic',
		description: 'Claude AI models',
		keyPrefix: 'sk-ant-',
		keyPlaceholder: 'sk-ant-...',
		consoleUrl: 'https://console.anthropic.com/settings/keys',
		models: [
			{
				id: 'claude-sonnet-4-20250514',
				name: 'Claude Sonnet 4',
				description: 'Best balance of intelligence and speed',
				maxTokens: 8192,
				freeTier: false,
			},
			{
				id: 'claude-3-5-haiku-20241022',
				name: 'Claude 3.5 Haiku',
				description: 'Fast and affordable',
				maxTokens: 8192,
				freeTier: false,
			},
		],
		defaultModel: 'claude-sonnet-4-20250514',
	};

	validateKeyFormat(key: string): boolean {
		return key.startsWith('sk-ant-');
	}

	async validateKey(key: string): Promise<boolean> {
		try {
			// Make a minimal request to check if the key is valid
			// Using claude-3-haiku with max_tokens=1 to minimize cost
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': key,
					'anthropic-version': '2023-06-01',
				},
				body: JSON.stringify({
					model: 'claude-3-haiku-20240307',
					max_tokens: 1,
					messages: [{ role: 'user', content: 'hi' }],
				}),
			});

			// 200 = valid key
			// 401 = invalid key
			// Other errors might be rate limits, etc. - treat as valid key for now
			if (response.status === 401) {
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
			const client = new Anthropic({ apiKey });

			const response = await client.messages.create(
				{
					model: modelId,
					max_tokens: 4096,
					system: systemPrompt,
					messages,
					stream: true,
				},
				{ signal }
			);

			let inputTokens = 0;
			let outputTokens = 0;

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
			await stream.writeSSE({
				event: 'error',
				data: JSON.stringify({ error: getSafeErrorMessage(error) }),
			});
		}
	}
}
