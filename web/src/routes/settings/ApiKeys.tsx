import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import styles from './ApiKeys.module.css';

interface ApiKey {
	provider: string;
	key_name: string;
	masked_key: string;
	last_used_at: string | null;
	created_at: string;
}

interface ProviderConfig {
	name: string;
	displayName: string;
	description: string;
	keyPlaceholder: string;
	consoleUrl: string;
	hasKey: boolean;
}

function formatRelativeTime(dateString: string | null): string {
	if (!dateString) return 'Never';

	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffMinutes < 1) return 'Just now';
	if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
	if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

	return date.toLocaleDateString();
}

export function ApiKeys(): JSX.Element {
	// API keys list
	const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
	const [providers, setProviders] = useState<ProviderConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Add key dialog
	const [showAddDialog, setShowAddDialog] = useState(false);
	const [selectedProvider, setSelectedProvider] = useState<string>('');
	const [newKeyName, setNewKeyName] = useState('');
	const [newApiKey, setNewApiKey] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [validating, setValidating] = useState(false);

	// Test key state
	const [testing, setTesting] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{ provider: string; success: boolean; error?: string } | null>(null);

	// Delete confirmation
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);

	// Dialog refs for focus management
	const dialogRef = useRef<HTMLDivElement>(null);
	const providerSelectRef = useRef<HTMLSelectElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	// Track mounted state for async operations
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Get current provider config
	const currentProviderConfig = providers.find(p => p.name === selectedProvider);

	// Close dialog handler
	const closeDialog = useCallback((): void => {
		setShowAddDialog(false);
		setSelectedProvider('');
		setNewKeyName('');
		setNewApiKey('');
		setAddError(null);
		previousFocusRef.current?.focus();
	}, []);

	// Focus trap and escape key handling for dialog
	useEffect(() => {
		if (!showAddDialog) return;

		previousFocusRef.current = document.activeElement as HTMLElement;

		const timer = setTimeout(() => {
			providerSelectRef.current?.focus();
		}, 0);

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeDialog();
				return;
			}

			if (e.key === 'Tab' && dialogRef.current) {
				const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
				);
				const firstElement = focusableElements[0];
				const lastElement = focusableElements[focusableElements.length - 1];

				if (e.shiftKey && document.activeElement === firstElement) {
					e.preventDefault();
					lastElement?.focus();
				} else if (!e.shiftKey && document.activeElement === lastElement) {
					e.preventDefault();
					firstElement?.focus();
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		return () => {
			clearTimeout(timer);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [showAddDialog, closeDialog]);

	// Load API keys and providers
	useEffect(() => {
		async function loadData(): Promise<void> {
			setLoading(true);
			setError(null);
			try {
				const [keys, providersResponse] = await Promise.all([
					fetchClient.get<ApiKey[]>('/api/users/me/api-keys'),
					fetchClient.get<{ providers: ProviderConfig[] }>('/api/chat/providers'),
				]);
				setApiKeys(keys);
				setProviders(providersResponse.providers);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : 'Failed to load API keys';
				setError(message);
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, []);

	// Open add dialog for a specific provider
	const openAddDialog = (providerName?: string): void => {
		setSelectedProvider(providerName || (providers[0]?.name || ''));
		setShowAddDialog(true);
	};

	// Handle add key (validates first, then stores)
	const handleValidate = async (): Promise<void> => {
		if (!selectedProvider || !newKeyName.trim() || !newApiKey.trim()) return;

		setAddError(null);
		setValidating(true);
		try {
			// Validate first, before storing the key
			const result = await fetchClient.post<{ valid: boolean; error?: string }>(
				`/api/users/me/api-keys/validate`,
				{
					provider: selectedProvider,
					api_key: newApiKey.trim(),
				}
			);

			if (!mountedRef.current) return;

			if (!result.valid) {
				setAddError(result.error || 'API key is invalid');
				return;
			}

			// Only store the key after successful validation
			const key = await fetchClient.post<ApiKey>('/api/users/me/api-keys', {
				provider: selectedProvider,
				key_name: newKeyName.trim(),
				api_key: newApiKey.trim(),
			});

			if (!mountedRef.current) return;

			setApiKeys([key, ...apiKeys.filter(k => k.provider !== selectedProvider)]);
			setProviders(providers.map(p =>
				p.name === selectedProvider ? { ...p, hasKey: true } : p
			));
			closeDialog();
		} catch (err: unknown) {
			if (!mountedRef.current) return;
			const message = err instanceof Error ? err.message : 'Failed to validate API key';
			setAddError(message);
		} finally {
			if (mountedRef.current) {
				setValidating(false);
			}
		}
	};

	// Handle test existing key
	const handleTestKey = async (provider: string): Promise<void> => {
		setTesting(provider);
		setTestResult(null);
		try {
			const result = await fetchClient.post<{ valid: boolean; error?: string }>(
				`/api/users/me/api-keys/${provider}/validate`
			);
			if (!mountedRef.current) return;
			setTestResult({
				provider,
				success: result.valid,
				error: result.error,
			});
			// Auto-dismiss test result after 5 seconds
			setTimeout(() => {
				if (mountedRef.current) {
					setTestResult(prev => prev?.provider === provider ? null : prev);
				}
			}, 5000);
		} catch (err: unknown) {
			if (!mountedRef.current) return;
			const message = err instanceof Error ? err.message : 'Test failed';
			setTestResult({
				provider,
				success: false,
				error: message,
			});
			// Auto-dismiss error after 5 seconds
			setTimeout(() => {
				if (mountedRef.current) {
					setTestResult(prev => prev?.provider === provider ? null : prev);
				}
			}, 5000);
		} finally {
			if (mountedRef.current) {
				setTesting(null);
			}
		}
	};

	// Handle delete key
	const handleDelete = async (provider: string): Promise<void> => {
		setDeleting(provider);
		try {
			await fetchClient.delete(`/api/users/me/api-keys/${provider}`);
			setApiKeys(apiKeys.filter(k => k.provider !== provider));
			setProviders(providers.map(p =>
				p.name === provider ? { ...p, hasKey: false } : p
			));
			setConfirmDelete(null);
			setTestResult(null);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to delete API key';
			setError(message);
		} finally {
			setDeleting(null);
		}
	};

	// Providers without keys
	const providersWithoutKeys = providers.filter(p => !p.hasKey);

	return (
		<div class={styles.container}>
			<h2 class={styles.title}>API Keys</h2>
			<p class={styles.description}>
				Manage API keys for AI providers. Your keys are encrypted and stored securely.
			</p>

			{error && (
				<div class={styles.error}>
					{error}
					<Button
						onClick={() => window.location.reload()}
						class={styles.retryButton}
					>
						Retry
					</Button>
				</div>
			)}

			{loading ? (
				<div class={styles.loading}>Loading API keys...</div>
			) : apiKeys.length === 0 ? (
				<div class={styles.empty}>
					<p>No API keys configured.</p>
					<Button
						onClick={() => openAddDialog()}
						class={styles.primaryButton}
					>
						Add API Key
					</Button>
				</div>
			) : (
				<>
					<div class={styles.list}>
						{apiKeys.map((key) => {
							const providerConfig = providers.find(p => p.name === key.provider);
							return (
								<div key={key.provider} class={styles.item}>
									<div class={styles.itemHeader}>
										<span class={styles.icon}><Icon name="key" class="size-lg" /></span>
										<div class={styles.itemInfo}>
											<div class={styles.providerName}>
												{providerConfig?.displayName || key.provider}
											</div>
											<div class={styles.keyName}>{key.key_name}</div>
										</div>
									</div>

									<div class={styles.itemDetails}>
										<div class={styles.maskedKey}>
											<code>{key.masked_key}</code>
										</div>
										<div class={styles.dates}>
											<span>Last used {formatRelativeTime(key.last_used_at)}</span>
										</div>
										{testResult?.provider === key.provider && (
											<div class={testResult.success ? styles.testSuccess : styles.testError}>
												{testResult.success ? 'Key is valid' : testResult.error || 'Key is invalid'}
											</div>
										)}
									</div>

									<div class={styles.itemActions}>
										{confirmDelete === key.provider ? (
											<div class={styles.confirmDelete}>
												<span class={styles.confirmText}>Delete this key?</span>
												<Button
													onClick={() => handleDelete(key.provider)}
													class={styles.dangerButton}
													disabled={deleting === key.provider}
												>
													{deleting === key.provider ? 'Deleting...' : 'Yes, Delete'}
												</Button>
												<Button
													onClick={() => setConfirmDelete(null)}
													class={styles.ghostButton}
													disabled={deleting === key.provider}
												>
													Cancel
												</Button>
											</div>
										) : (
											<>
												<Button
													onClick={() => handleTestKey(key.provider)}
													class={styles.ghostButton}
													disabled={testing === key.provider}
												>
													{testing === key.provider ? 'Testing...' : 'Test'}
												</Button>
												<Button
													onClick={() => setConfirmDelete(key.provider)}
													class={styles.ghostButton}
												>
													Delete
												</Button>
											</>
										)}
									</div>
								</div>
							);
						})}
					</div>

					{providersWithoutKeys.length > 0 && (
						<div class={styles.addSection}>
							{providersWithoutKeys.map(provider => (
								<Button
									key={provider.name}
									onClick={() => openAddDialog(provider.name)}
									class={styles.ghostButton}
								>
									Add {provider.displayName} Key
								</Button>
							))}
						</div>
					)}
				</>
			)}

			{/* Add Key Dialog */}
			{showAddDialog && (
				<div
					class={styles.overlay}
					onClick={closeDialog}
					role="presentation"
				>
					<div
						ref={dialogRef}
						class={styles.dialog}
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="add-key-dialog-title"
					>
						<h3 id="add-key-dialog-title" class={styles.dialogTitle}>Add API Key</h3>

						{addError && (
							<div class={styles.dialogError}>{addError}</div>
						)}

						<div class={styles.formField}>
							<label class={styles.label} for="provider">Provider</label>
							<select
								ref={providerSelectRef}
								id="provider"
								class={styles.input}
								value={selectedProvider}
								onChange={(e) => setSelectedProvider((e.target as HTMLSelectElement).value)}
							>
								{providers.filter(p => !p.hasKey).map(provider => (
									<option key={provider.name} value={provider.name}>
										{provider.displayName}
									</option>
								))}
							</select>
							{currentProviderConfig && (
								<p class={styles.hint}>
									{currentProviderConfig.description}. Get your API key from{' '}
									<a
										href={currentProviderConfig.consoleUrl}
										target="_blank"
										rel="noopener noreferrer"
										class={styles.link}
									>
										{new URL(currentProviderConfig.consoleUrl).hostname}
									</a>
								</p>
							)}
						</div>

						<div class={styles.formField}>
							<label class={styles.label} for="key-name">Key Name</label>
							<input
								id="key-name"
								type="text"
								class={styles.input}
								placeholder="e.g., Personal Key"
								value={newKeyName}
								onInput={(e) => setNewKeyName((e.target as HTMLInputElement).value)}
							/>
						</div>

						<div class={styles.formField}>
							<label class={styles.label} for="api-key">API Key</label>
							<input
								id="api-key"
								type="password"
								class={styles.input}
								placeholder={currentProviderConfig?.keyPlaceholder || 'Enter API key'}
								value={newApiKey}
								onInput={(e) => setNewApiKey((e.target as HTMLInputElement).value)}
							/>
						</div>

						<div class={styles.dialogActions}>
							<Button
								onClick={closeDialog}
								class={styles.ghostButton}
								disabled={validating}
							>
								Cancel
							</Button>
							<Button
								onClick={handleValidate}
								class={styles.primaryButton}
								disabled={!selectedProvider || !newKeyName.trim() || !newApiKey.trim() || validating}
							>
								{validating ? 'Validating...' : 'Add Key'}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
