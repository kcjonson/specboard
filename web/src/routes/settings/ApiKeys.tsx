import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import styles from './ApiKeys.module.css';

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
	anthropic: 'Anthropic',
};

// Provider descriptions
const PROVIDER_DESCRIPTIONS: Record<string, string> = {
	anthropic: 'Powers the AI Chat sidebar in the editor',
};

interface ApiKey {
	provider: string;
	key_name: string;
	masked_key: string;
	last_used_at: string | null;
	created_at: string;
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
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Add key dialog
	const [showAddDialog, setShowAddDialog] = useState(false);
	const [newKeyName, setNewKeyName] = useState('');
	const [newApiKey, setNewApiKey] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [validating, setValidating] = useState(false);

	// Delete confirmation
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);

	// Dialog refs for focus management
	const dialogRef = useRef<HTMLDivElement>(null);
	const keyNameInputRef = useRef<HTMLInputElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	// Close dialog handler
	const closeDialog = useCallback((): void => {
		setShowAddDialog(false);
		setNewKeyName('');
		setNewApiKey('');
		setAddError(null);
		// Restore focus to previously focused element
		previousFocusRef.current?.focus();
	}, []);

	// Focus trap and escape key handling for dialog
	useEffect(() => {
		if (!showAddDialog) return;

		// Store previously focused element
		previousFocusRef.current = document.activeElement as HTMLElement;

		// Auto-focus the key name input
		// Use timeout to ensure dialog is rendered
		const timer = setTimeout(() => {
			keyNameInputRef.current?.focus();
		}, 0);

		// Handle escape key
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeDialog();
				return;
			}

			// Focus trap: Tab key cycles within dialog
			if (e.key === 'Tab' && dialogRef.current) {
				const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
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

	// Load API keys
	useEffect(() => {
		async function loadKeys(): Promise<void> {
			setLoading(true);
			setError(null);
			try {
				const keys = await fetchClient.get<ApiKey[]>('/api/users/me/api-keys');
				setApiKeys(keys);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : 'Failed to load API keys';
				setError(message);
			} finally {
				setLoading(false);
			}
		}
		loadKeys();
	}, []);

	// Handle add key
	const handleAdd = async (): Promise<void> => {
		if (!newKeyName.trim() || !newApiKey.trim()) return;

		setAddError(null);
		setAdding(true);
		try {
			const key = await fetchClient.post<ApiKey>('/api/users/me/api-keys', {
				provider: 'anthropic',
				key_name: newKeyName.trim(),
				api_key: newApiKey.trim(),
			});
			setApiKeys([key, ...apiKeys.filter(k => k.provider !== 'anthropic')]);
			setShowAddDialog(false);
			setNewKeyName('');
			setNewApiKey('');
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to add API key';
			setAddError(message);
		} finally {
			setAdding(false);
		}
	};

	// Handle validate key
	const handleValidate = async (): Promise<void> => {
		if (!newApiKey.trim()) return;

		setAddError(null);
		setValidating(true);
		try {
			// First add the key temporarily, then validate
			await fetchClient.post<ApiKey>('/api/users/me/api-keys', {
				provider: 'anthropic',
				key_name: newKeyName.trim() || 'Anthropic API Key',
				api_key: newApiKey.trim(),
			});

			const result = await fetchClient.post<{ valid: boolean; error?: string }>(
				'/api/users/me/api-keys/anthropic/validate'
			);

			if (!result.valid) {
				setAddError(result.error || 'API key is invalid');
				// Remove the invalid key
				await fetchClient.delete('/api/users/me/api-keys/anthropic');
			} else {
				// Reload to get the new key
				const keys = await fetchClient.get<ApiKey[]>('/api/users/me/api-keys');
				setApiKeys(keys);
				setShowAddDialog(false);
				setNewKeyName('');
				setNewApiKey('');
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to validate API key';
			setAddError(message);
		} finally {
			setValidating(false);
		}
	};

	// Handle delete key
	const handleDelete = async (provider: string): Promise<void> => {
		setDeleting(provider);
		try {
			await fetchClient.delete(`/api/users/me/api-keys/${provider}`);
			setApiKeys(apiKeys.filter(k => k.provider !== provider));
			setConfirmDelete(null);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to delete API key';
			setError(message);
		} finally {
			setDeleting(null);
		}
	};

	// Check if Anthropic key exists
	const hasAnthropicKey = apiKeys.some(k => k.provider === 'anthropic');

	return (
		<div class={styles.container}>
			<h2 class={styles.title}>API Keys</h2>
			<p class={styles.description}>
				Manage API keys for external services. Your keys are encrypted and stored securely.
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
						onClick={() => setShowAddDialog(true)}
						class={styles.primaryButton}
					>
						Add Anthropic API Key
					</Button>
				</div>
			) : (
				<>
					<div class={styles.list}>
						{apiKeys.map((key) => (
							<div key={key.provider} class={styles.item}>
								<div class={styles.itemHeader}>
									<span class={styles.icon}><Icon name="key" class="size-lg" /></span>
									<div class={styles.itemInfo}>
										<div class={styles.providerName}>
											{PROVIDER_NAMES[key.provider] || key.provider}
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
										<Button
											onClick={() => setConfirmDelete(key.provider)}
											class={styles.ghostButton}
										>
											Delete
										</Button>
									)}
								</div>
							</div>
						))}
					</div>

					{!hasAnthropicKey && (
						<div class={styles.addSection}>
							<Button
								onClick={() => setShowAddDialog(true)}
								class={styles.primaryButton}
							>
								Add Anthropic API Key
							</Button>
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
						<h3 id="add-key-dialog-title" class={styles.dialogTitle}>Add Anthropic API Key</h3>
						<p class={styles.dialogDescription}>
							{PROVIDER_DESCRIPTIONS.anthropic}. Get your API key from{' '}
							<a
								href="https://console.anthropic.com/settings/keys"
								target="_blank"
								rel="noopener noreferrer"
								class={styles.link}
							>
								console.anthropic.com
							</a>
						</p>

						{addError && (
							<div class={styles.dialogError}>{addError}</div>
						)}

						<div class={styles.formField}>
							<label class={styles.label} for="key-name">Key Name</label>
							<input
								ref={keyNameInputRef}
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
								placeholder="sk-ant-..."
								value={newApiKey}
								onInput={(e) => setNewApiKey((e.target as HTMLInputElement).value)}
							/>
						</div>

						<div class={styles.dialogActions}>
							<Button
								onClick={closeDialog}
								class={styles.ghostButton}
								disabled={adding || validating}
							>
								Cancel
							</Button>
							<Button
								onClick={handleValidate}
								class={styles.ghostButton}
								disabled={!newApiKey.trim() || adding || validating}
							>
								{validating ? 'Validating...' : 'Validate & Add'}
							</Button>
							<Button
								onClick={handleAdd}
								class={styles.primaryButton}
								disabled={!newKeyName.trim() || !newApiKey.trim() || adding || validating}
							>
								{adding ? 'Adding...' : 'Add Key'}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
