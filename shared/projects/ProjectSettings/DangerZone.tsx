import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { fetchClient } from '@specboard/fetch';
import { Button, ConfirmDialog } from '@specboard/ui';
import { SectionHeader } from './SectionHeader';
import styles from './ProjectSettings.module.css';

export interface DangerZoneProps {
	title: string;
	projectRef: string;
	projectName: string;
}

export function DangerZone({ title, projectRef, projectName }: DangerZoneProps): JSX.Element {
	const [confirming, setConfirming] = useState(false);

	async function handleDelete(): Promise<void> {
		await fetchClient.delete(`/api/projects/${projectRef}`);
		navigate('/projects', { replace: true });
	}

	return (
		<div class={styles.form}>
			<SectionHeader title={title} />
			<div class={styles.dangerRow}>
				<div>
					<p class={styles.dangerTitle}>Delete this project</p>
					<p class={styles.hint}>Its board, items and settings are deleted for everyone on it. The GitHub repository is left alone.</p>
				</div>
				<Button class="danger" onClick={() => setConfirming(true)}>Delete project</Button>
			</div>
			<ConfirmDialog
				open={confirming}
				title={`Delete ${projectName}?`}
				message="Everything in this project is deleted for you and every member."
				warning="This can't be undone."
				confirmText="Delete project"
				busyText="Deleting..."
				onConfirm={handleDelete}
				onCancel={() => setConfirming(false)}
			/>
		</div>
	);
}
