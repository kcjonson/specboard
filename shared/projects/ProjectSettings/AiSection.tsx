import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchErrorText } from '@specboard/fetch';
import { Button, Notice } from '@specboard/ui';
import type { ProjectModel } from '@specboard/models';
import { saveProject } from './settings-api';
import styles from './ProjectSettings.module.css';

const MAX_PROMPT_LENGTH = 10000;

export interface AiSectionProps {
	project: ProjectModel;
	projectRef: string;
}

/** The project's instructions for the AI assistant. */
export function AiSection({ project, projectRef }: AiSectionProps): JSX.Element {
	const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? '');
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		setSaving(true);
		setStatus(null);
		try {
			await saveProject(project, projectRef, { system_prompt: systemPrompt.trim() });
			setStatus({ variant: 'success', text: 'Saved.' });
		} catch (err) {
			setStatus({ variant: 'error', text: fetchErrorText(err, 'Failed to save the instructions') });
		} finally {
			setSaving(false);
		}
	}

	return (
		<form class={styles.form} onSubmit={handleSubmit}>
			<label class={styles.field}>
				<span class={styles.label}>AI instructions</span>
				<span class={styles.hint}>Custom instructions for the AI assistant when working in this project.</span>
				<textarea
					value={systemPrompt}
					onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
					placeholder="e.g., Always respond in bullet points. Use formal tone."
					rows={8}
					maxLength={MAX_PROMPT_LENGTH}
				/>
				<span class={styles.charCount}>{systemPrompt.length.toLocaleString()} / {MAX_PROMPT_LENGTH.toLocaleString()}</span>
			</label>

			{status && <Notice variant={status.variant}>{status.text}</Notice>}

			<div class={styles.formActions}>
				<Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
			</div>
		</form>
	);
}
