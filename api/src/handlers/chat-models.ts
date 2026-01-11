/**
 * Chat models handler
 *
 * Endpoint: GET /api/chat/models
 *
 * Returns available AI models based on the user's configured API keys.
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { query, type UserApiKey } from '@doc-platform/db';
import { PROVIDER_NAMES, getProvider, type ProviderName, type ModelInfo } from '../providers/index.ts';

/**
 * Model response with provider information
 */
interface ModelResponse {
	provider: ProviderName;
	providerDisplayName: string;
	models: ModelInfo[];
}

/**
 * Provider configuration for frontend
 */
interface ProviderConfigResponse {
	name: ProviderName;
	displayName: string;
	description: string;
	keyPlaceholder: string;
	consoleUrl: string;
	hasKey: boolean;
}

/**
 * Get available models for the current user
 * GET /api/chat/models
 *
 * Returns models grouped by provider, only including providers
 * for which the user has configured an API key.
 */
export async function handleGetChatModels(
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

	try {
		// Get user's configured API keys
		const result = await query<UserApiKey>(
			'SELECT provider FROM user_api_keys WHERE user_id = $1',
			[session.userId]
		);

		const configuredProviders = new Set(result.rows.map(row => row.provider));

		// Build response with models from configured providers
		const availableModels: ModelResponse[] = [];

		for (const providerName of PROVIDER_NAMES) {
			if (configuredProviders.has(providerName)) {
				const provider = getProvider(providerName);
				availableModels.push({
					provider: providerName,
					providerDisplayName: provider.config.displayName,
					models: provider.config.models,
				});
			}
		}

		return context.json({
			models: availableModels,
		});
	} catch (error) {
		console.error('Failed to get chat models:', error);
		return context.json({ error: 'Failed to get available models' }, 500);
	}
}

/**
 * Get provider configurations for settings page
 * GET /api/chat/providers
 *
 * Returns all provider configurations with info about whether
 * the user has a key configured for each.
 */
export async function handleGetChatProviders(
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

	try {
		// Get user's configured API keys
		const result = await query<UserApiKey>(
			'SELECT provider FROM user_api_keys WHERE user_id = $1',
			[session.userId]
		);

		const configuredProviders = new Set(result.rows.map(row => row.provider));

		// Build response with all providers
		const providers: ProviderConfigResponse[] = PROVIDER_NAMES.map(providerName => {
			const provider = getProvider(providerName);
			return {
				name: providerName,
				displayName: provider.config.displayName,
				description: provider.config.description,
				keyPlaceholder: provider.config.keyPlaceholder,
				consoleUrl: provider.config.consoleUrl,
				hasKey: configuredProviders.has(providerName),
			};
		});

		return context.json({ providers });
	} catch (error) {
		console.error('Failed to get chat providers:', error);
		return context.json({ error: 'Failed to get providers' }, 500);
	}
}
