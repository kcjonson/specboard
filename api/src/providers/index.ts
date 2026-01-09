/**
 * Provider registry and exports
 *
 * Central registry for all AI providers.
 */

import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import type { ChatProvider, ProviderName, ProviderConfig, ModelInfo } from './types.js';

// Re-export types
export type { ChatProvider, ProviderName, ProviderConfig, ModelInfo, ChatMessage } from './types.js';

/**
 * Provider instances
 */
const anthropicProvider = new AnthropicProvider();
const geminiProvider = new GeminiProvider();

/**
 * Provider registry
 */
export const providers: Record<ProviderName, ChatProvider> = {
	anthropic: anthropicProvider,
	gemini: geminiProvider,
};

/**
 * List of all provider names
 */
export const PROVIDER_NAMES: ProviderName[] = ['anthropic', 'gemini'];

/**
 * Get a provider by name
 */
export function getProvider(name: ProviderName): ChatProvider {
	return providers[name];
}

/**
 * Check if a string is a valid provider name
 */
export function isValidProvider(name: string): name is ProviderName {
	return name in providers;
}

/**
 * Get all provider configs (for API responses)
 */
export function getAllProviderConfigs(): ProviderConfig[] {
	return PROVIDER_NAMES.map(name => providers[name].config);
}

/**
 * Get models for a specific provider
 */
export function getProviderModels(name: ProviderName): ModelInfo[] {
	return providers[name].config.models;
}

/**
 * Check if a model ID is valid for a provider
 */
export function isValidModel(providerName: ProviderName, modelId: string): boolean {
	const provider = providers[providerName];
	return provider.config.models.some(m => m.id === modelId);
}
