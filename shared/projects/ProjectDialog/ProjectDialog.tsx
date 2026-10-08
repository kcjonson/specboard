import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, DialogFooter, Button } from '@specboard/ui';
import { RepositoryPicker, type RepositoryConfig } from '../RepositoryPicker/RepositoryPicker';
import styles from './ProjectDialog.module.css';

export interface NewProject {
	name: string;
	description?: string;
	systemPrompt?: string;
	repository?: RepositoryConfig;
}

export interface ProjectDialogProps {
	/** Called when dialog should close */
	onClose: () => void;
	/** Create the project. A rejection is shown in the dialog, which keeps the user's input. */
	onCreate: (project: NewProject) => Promise<void>;
}

/**
 * Create a project. The server derives its slug and key from the name; changing them,
 * and everything else about an existing project, is the project settings page.
 */
export function ProjectDialog({ onClose, onCreate }: ProjectDialogProps): JSX.Element {
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [systemPrompt, setSystemPrompt] = useState('');
	const [repository, setRepository] = useState<RepositoryConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Track if component is mounted to prevent state updates after unmount
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const canSubmit = Boolean(name.trim()) && !saving;

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!canSubmit) return;

		try {
			setSaving(true);
			setError(null);
			await onCreate({
				name: name.trim(),
				description: description.trim() || undefined,
				systemPrompt: systemPrompt.trim() || undefined,
				repository: repository ?? undefined,
			});
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : 'Failed to create project');
			}
		} finally {
			if (mountedRef.current) setSaving(false);
		}
	}

	return (
		<Dialog title="Create Project" onClose={onClose}>
			<form class={styles.form} onSubmit={handleSubmit}>
				{error && (
					<p class={styles.error}>{error}</p>
				)}
				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>Name</span>
						<input
							type="text"
							class={styles.input}
							value={name}
							onInput={(e) => setName((e.target as HTMLInputElement).value)}
							placeholder="My Project"
							autoFocus
						/>
					</label>
				</div>
				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>Description (optional)</span>
						<textarea
							class={styles.textarea}
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							placeholder="A brief description of your project"
							rows={3}
						/>
					</label>
				</div>

				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>AI Instructions (optional)</span>
						<span class={styles.hint}>Custom instructions for the AI assistant when working in this project.</span>
						<textarea
							class={styles.textarea}
							value={systemPrompt}
							onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
							placeholder="e.g., Always respond in bullet points. Use formal tone."
							rows={4}
							maxLength={10000}
						/>
						<span class={styles.charCount}>{systemPrompt.length} / 10,000</span>
					</label>
				</div>

				<div class={styles.repositorySection}>
					<div class={styles.sectionHeader}>
						<span class={styles.labelText}>Repository (optional)</span>
						<span class={styles.hint}>Connect a GitHub repository to store documents. Once connected it can't be changed.</span>
					</div>
					<RepositoryPicker onChange={setRepository} disabled={saving} />
				</div>

				<DialogFooter>
					<Button type="button" class="text" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={!canSubmit}>
						{saving ? 'Creating...' : 'Create'}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
