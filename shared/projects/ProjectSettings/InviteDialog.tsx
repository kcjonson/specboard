import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient, fetchErrorText } from '@specboard/fetch';
import { Button, Dialog, DialogFooter, Icon } from '@specboard/ui';
import { GitHubReposCollection, useModel } from '@specboard/models';
import type { MemberRole, PendingInvitation } from './settings-api';
import styles from './ProjectSettings.module.css';

export interface InviteDialogProps {
	projectRef: string;
	projectName: string;
	/** The connected repository as owner/repo, or null without one. */
	repositoryName: string | null;
	onClose: () => void;
	/** Called with the new invitation once it is sent. */
	onInvited: (invitation: PendingInvitation) => void;
}

/**
 * Whether the connected repository is private, read off the owner's own GitHub repository
 * list (the one the repository picker uses, cached server-side). Null while that's loading
 * or when it can't say: no GitHub connection, or the repository isn't in the list.
 */
function useRepositoryIsPrivate(repositoryName: string | null): boolean | null {
	const repos = useMemo(() => (repositoryName ? new GitHubReposCollection() : null), [repositoryName]);
	useModel(repos);
	if (!repos || !repositoryName) return null;
	const wanted = repositoryName.toLowerCase();
	return repos.find((repo) => repo.fullName.toLowerCase() === wanted)?.private ?? null;
}

export function InviteDialog({ projectRef, projectName, repositoryName, onClose, onInvited }: InviteDialogProps): JSX.Element {
	const [email, setEmail] = useState('');
	const [role, setRole] = useState<MemberRole>('editor');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isPrivate = useRepositoryIsPrivate(repositoryName);

	const canSend = email.trim().length > 0 && !sending;

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!canSend) return;
		setSending(true);
		setError(null);
		try {
			const invitation = await fetchClient.post<PendingInvitation>(`/api/projects/${projectRef}/invitations`, {
				email: email.trim(),
				role,
			});
			onInvited(invitation);
		} catch (err) {
			// 409 names an address that is already the owner's or a member's; 429 is the
			// owner's hourly invite budget. The server's wording says which.
			setError(fetchErrorText(err, 'Failed to send the invitation'));
			setSending(false);
		}
	}

	return (
		<Dialog title={`Invite to ${projectName}`} onClose={onClose} maxWidth="sm">
			<form class={styles.form} onSubmit={handleSubmit}>
				<label class={styles.field}>
					<span class={styles.label}>Email</span>
					<input
						type="email"
						value={email}
						onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
						placeholder="pat@example.com"
						autoComplete="off"
						autoFocus
					/>
				</label>

				<label class={styles.field}>
					<span class={styles.label}>Role</span>
					<select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as MemberRole)}>
						<option value="editor">Editor</option>
						<option value="viewer">Viewer</option>
					</select>
					<span class={styles.hint}>
						{role === 'editor'
							? 'Editors need their own GitHub account connected before they can edit. Until then they can view.'
							: 'Viewers can see the board and documents but not change them.'}
					</span>
				</label>

				{isPrivate && (
					<p class={styles.privateNote}>
						<Icon name="alert-circle" class="size-sm" aria-hidden />
						<span>{repositoryName} is a private repository. Members can read its documents here.</span>
					</p>
				)}

				{error && <p class={styles.formError} role="alert">{error}</p>}

				<DialogFooter>
					<Button type="button" class="text" onClick={onClose}>Cancel</Button>
					<Button type="submit" disabled={!canSend}>{sending ? 'Sending...' : 'Send invite'}</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
