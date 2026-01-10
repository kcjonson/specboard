/* global localStorage */
import { useState, useEffect, useCallback } from 'preact/hooks';

export interface ModelInfo {
	id: string;
	name: string;
	description: string;
	freeTier?: boolean;
}

export interface ProviderModels {
	provider: string;
	providerDisplayName: string;
	models: ModelInfo[];
}

export interface ModelSelection {
	provider: string;
	model: string;
}

// LocalStorage key for persisting model selection
const MODEL_STORAGE_KEY = 'chat-selected-model';

/**
 * Parse a model selection string (format: "provider:modelId")
 */
export function parseModelSelection(value: string): ModelSelection | null {
	const parts = value.split(':');
	if (parts.length !== 2) return null;
	return { provider: parts[0], model: parts[1] };
}

/**
 * Create a model selection string
 */
export function createModelSelection(provider: string, model: string): string {
	return `${provider}:${model}`;
}

export interface UseModelSelectionReturn {
	availableModels: ProviderModels[];
	selectedModel: string;
	modelsLoading: boolean;
	modelsError: string | null;
	hasNoModels: boolean;
	hasModelsError: boolean;
	handleModelChange: (e: Event) => void;
}

/**
 * Hook for managing AI model selection with localStorage persistence
 */
export function useModelSelection(): UseModelSelectionReturn {
	const [availableModels, setAvailableModels] = useState<ProviderModels[]>([]);
	const [selectedModel, setSelectedModel] = useState<string>('');
	const [modelsLoading, setModelsLoading] = useState(true);
	const [modelsError, setModelsError] = useState<string | null>(null);

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

	const handleModelChange = useCallback((e: Event): void => {
		const value = (e.target as HTMLSelectElement).value;
		setSelectedModel(value);
	}, []);

	// Derived state
	const hasNoModels = !modelsLoading && !modelsError && availableModels.length === 0;
	const hasModelsError = !modelsLoading && modelsError !== null;

	return {
		availableModels,
		selectedModel,
		modelsLoading,
		modelsError,
		hasNoModels,
		hasModelsError,
		handleModelChange,
	};
}
