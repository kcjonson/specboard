import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Text, Icon } from '@specboard/ui';
import { fetchClient, FetchError } from '@specboard/fetch';
import {
	browserSupportsWebAuthn,
	createPasskey,
	passkeyErrorMessage,
	type PublicKeyCredentialCreationOptionsJSON,
} from '../../lib/webauthn';
import { fetchErrorText } from '../../lib/errors';
import styles from './Passkeys.module.css';

interface Passkey {
	id: string;
	name: string;
	device_type: string | null;
	backed_up: boolean;
	created_at: string;
	last_used_at: string | null;
}

interface RegisterOptionsResponse {
	challengeId: string;
	options: PublicKeyCredentialCreationOptionsJSON;
}

function deviceLabel(passkey: Passkey): string {
	if (passkey.device_type === 'multiDevice' || passkey.backed_up) return 'Synced across your devices';
	if (passkey.device_type === 'singleDevice') return 'This device only';
	return 'Passkey';
}

function formatDate(value: string | null): string {
	if (!value) return 'never';
	return new Date(value).toLocaleDateString();
}

/**
 * Passkey management: list, add (runs the WebAuthn registration ceremony),
 * rename, and remove. Rendered as its own settings card.
 */
export function Passkeys(): JSX.Element {
	const supported = browserSupportsWebAuthn();

	const [passkeys, setPasskeys] = useState<Passkey[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState('');

	const load = useCallback(async (): Promise<void> => {
		try {
			const data = await fetchClient.get<{ passkeys: Passkey[] }>('/api/auth/webauthn/credentials');
			setPasskeys(data.passkeys);
		} catch (err: unknown) {
			setError(fetchErrorText(err, 'Could not load your passkeys.'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (supported) void load();
		else setLoading(false);
	}, [supported, load]);

	const startRename = (passkey: Passkey): void => {
		setConfirmDelete(null);
		setRenamingId(passkey.id);
		setRenameValue(passkey.name);
	};

	const startDelete = (id: string): void => {
		setRenamingId(null);
		setConfirmDelete(id);
	};

	const handleAdd = async (): Promise<void> => {
		setError(null);
		setAdding(true);
		try {
			const { challengeId, options } = await fetchClient.post<RegisterOptionsResponse>(
				'/api/auth/webauthn/register/options'
			);
			const response = await createPasskey(options);
			await fetchClient.post('/api/auth/webauthn/register/verify', { challengeId, response });
			await load();
		} catch (err: unknown) {
			// API errors are shown; a user-cancel (passkeyErrorMessage → null) stays silent.
			if (err instanceof FetchError) {
				setError(fetchErrorText(err, 'Could not register the passkey.'));
			} else {
				const message = passkeyErrorMessage(err, 'Could not register the passkey.');
				if (message) setError(message);
			}
		} finally {
			setAdding(false);
		}
	};

	const handleRename = async (id: string): Promise<void> => {
		const name = renameValue.trim();
		if (!name) return;
		setBusyId(id);
		setError(null);
		try {
			await fetchClient.patch(`/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, { name });
			// Update locally — a follow-up refetch that blipped would wrongly read
			// as the rename having failed.
			setPasskeys((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
			setRenamingId(null);
		} catch (err: unknown) {
			setError(fetchErrorText(err, 'Could not rename the passkey.'));
		} finally {
			setBusyId(null);
		}
	};

	const handleDelete = async (id: string): Promise<void> => {
		setBusyId(id);
		setError(null);
		try {
			await fetchClient.delete(`/api/auth/webauthn/credentials/${encodeURIComponent(id)}`);
			setPasskeys((prev) => prev.filter((p) => p.id !== id));
			setConfirmDelete(null);
		} catch (err: unknown) {
			setError(fetchErrorText(err, 'Could not remove the passkey.'));
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div class={styles.card}>
			<h2 class={styles.sectionTitle}>Passkeys</h2>
			<p class={styles.description}>
				Sign in with your fingerprint, face, or device PIN instead of a password.
			</p>

			{!supported && (
				<p class={styles.notice}>This browser doesn't support passkeys.</p>
			)}

			{error && <p class={styles.error} role="alert">{error}</p>}

			{supported && !loading && passkeys.length > 0 && (
				<div class={styles.list}>
					{passkeys.map((passkey) => (
						<div key={passkey.id} class={styles.item}>
							<span class={styles.icon}><Icon name="key" class="size-lg" /></span>
							{renamingId === passkey.id ? (
								<form
									class={styles.renameForm}
									onSubmit={(e: Event) => { e.preventDefault(); void handleRename(passkey.id); }}
								>
									<Text
										id={`rename-${passkey.id}`}
										ariaLabel="Passkey name"
										autoFocus
										value={renameValue}
										onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
									/>
									<Button type="submit" disabled={busyId === passkey.id || !renameValue.trim()}>Save</Button>
									<Button type="button" variant="secondary" onClick={() => setRenamingId(null)}>Cancel</Button>
								</form>
							) : (
								<>
									<div class={styles.info}>
										<div class={styles.name}>{passkey.name}</div>
										<div class={styles.meta}>
											{deviceLabel(passkey)} · added {formatDate(passkey.created_at)} · last used {formatDate(passkey.last_used_at)}
										</div>
									</div>
									<div class={styles.actions}>
										{confirmDelete === passkey.id ? (
											<>
												<span class={styles.confirmText}>Remove?</span>
												<Button variant="danger" disabled={busyId === passkey.id} onClick={() => void handleDelete(passkey.id)}>
													{busyId === passkey.id ? 'Removing...' : 'Yes, remove'}
												</Button>
												<Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
											</>
										) : (
											<>
												<Button variant="secondary" aria-label={`Rename ${passkey.name}`} onClick={() => startRename(passkey)}>
													Rename
												</Button>
												<Button variant="secondary" aria-label={`Remove ${passkey.name}`} onClick={() => startDelete(passkey.id)}>
													Remove
												</Button>
											</>
										)}
									</div>
								</>
							)}
						</div>
					))}
				</div>
			)}

			{supported && !loading && passkeys.length === 0 && (
				<p class={styles.notice}>You haven't added any passkeys yet.</p>
			)}

			{supported && (
				<div class={styles.addRow}>
					<Button onClick={() => void handleAdd()} disabled={adding}>
						{adding ? 'Follow your browser...' : 'Add a passkey'}
					</Button>
				</div>
			)}
		</div>
	);
}
