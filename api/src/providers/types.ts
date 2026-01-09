/**
 * Provider types and interfaces
 *
 * Defines the contract that all AI providers must implement.
 */

import type { SSEStreamingApi } from 'hono/streaming';

/**
 * Supported provider names
 */
export type ProviderName = 'anthropic' | 'gemini';

/**
 * Chat message format (common across all providers)
 */
export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * Model information for a provider
 */
export interface ModelInfo {
	id: string;
	name: string;
	description: string;
	maxTokens: number;
	contextWindow?: number;
	/** Whether this model is available on the provider's free tier */
	freeTier?: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
	name: ProviderName;
	displayName: string;
	description: string;
	keyPrefix: string;
	keyPlaceholder: string;
	consoleUrl: string;
	models: ModelInfo[];
	defaultModel: string;
}

/**
 * Chat provider interface
 *
 * All AI providers must implement this interface.
 */
export interface ChatProvider {
	readonly config: ProviderConfig;

	/**
	 * Validate API key format (basic client-side validation)
	 */
	validateKeyFormat(key: string): boolean;

	/**
	 * Test API key against provider's API
	 */
	validateKey(key: string): Promise<boolean>;

	/**
	 * Stream chat response to client
	 * @param signal - AbortSignal for cancellation (e.g., on timeout)
	 */
	streamChat(
		stream: SSEStreamingApi,
		apiKey: string,
		modelId: string,
		systemPrompt: string,
		messages: ChatMessage[],
		signal?: AbortSignal
	): Promise<void>;
}
