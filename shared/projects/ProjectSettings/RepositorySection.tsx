import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { fetchClient } from '@specboard/fetch';
import { Button, Icon, Notice } from '@specboard/ui';
import { writeFailure, type ProjectModel } from '@specboard/models';
import { RepositoryPicker, type RepositoryConfig } from '../RepositoryPicker/RepositoryPicker';
import { SyncProgressDialog } from '../SyncProgressDialog/SyncProgressDialog';
import { saveProject } from './settings-api';
import styles from './ProjectSettings.module.css';

export interface RepositorySectionProps {
	project: ProjectModel;
	projectRef: string;
}

/**
 * The project's GitHub repository: shown once connected (it can't be changed), or picked
 * and attached for a project that has none. Attaching starts the initial clone.
 */
export function RepositorySection({ project, projectRef }: RepositorySectionProps): JSX.Element {
	const [picked, setPicked] = useState<RepositoryConfig | null>(null);
	const [attaching, setAttaching] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { repository } = project;
	const remote = repository?.type === 'cloud' ? repository.remote : undefined;

	async function handleAttach(): Promise<void> {
		if (!picked || attaching) return;
		setAttaching(true);
		setError(null);
		try {
			await saveProject(project, projectRef, { repository: picked });
			setSyncing(true);
		} catch (err) {
			setError(writeFailure(err, 'Failed to connect the repository', projectRef));
		} finally {
			setAttaching(false);
		}
	}

	async function handleRetrySync(): Promise<void> {
		if (retrying) return;
		setRetrying(true);
		setError(null);
		try {
			await fetchClient.post(`/api/projects/${projectRef}/sync/initial`);
			setSyncing(true);
		} catch (err) {
			setError(writeFailure(err, 'Failed to retry the sync', projectRef));
		} finally {
			setRetrying(false);
		}
	}

	function handleSyncDone(destination?: 'planning' | 'pages'): void {
		setSyncing(false);
		// The sync status the server set after answering.
		project.fetch().catch(() => undefined);
		if (destination) navigate(`/projects/${projectRef}/${destination}`);
	}

	let body: JSX.Element;
	if (remote) {
		body = (
			<>
				<div class={styles.repoDisplay}>
					<Icon name="github" class="size-sm" />
					<a href={remote.url} target="_blank" rel="noopener noreferrer" class={styles.repoLink}>
						{remote.owner}/{remote.repo}
					</a>
					<span class={styles.branchBadge}>
						<Icon name="git-branch" class="size-xs" />
						{repository.branch}
					</span>
				</div>
				<p class={styles.hint}>A connected repository can't be changed.</p>
				<div class={styles.syncStatus}>
					{project.syncStatus === 'pending' || project.syncStatus === 'syncing' ? (
						<>
							<span class={styles.spinner} />
							<span>Syncing...</span>
						</>
					) : project.syncStatus === 'completed' ? (
						<>
							<span class={styles.successDot} />
							<span>Synced</span>
						</>
					) : project.syncStatus === 'failed' ? (
						<>
							<span class={styles.errorDot} />
							<span class={styles.errorText}>Sync failed</span>
							{project.syncError && <span class={styles.errorDetail}>{project.syncError}</span>}
							<Button class="secondary size-sm" onClick={handleRetrySync} busy={retrying}>
								{retrying ? 'Retrying...' : 'Retry sync'}
							</Button>
						</>
					) : null}
				</div>
			</>
		);
	} else if (repository?.type === 'local') {
		body = <p class={styles.hint}>This project's documents come from folders on your computer, added in the desktop app.</p>;
	} else {
		body = (
			<>
				<p class={styles.hint}>Connect a GitHub repository to store documents. Once connected it can't be changed.</p>
				<RepositoryPicker onChange={setPicked} disabled={attaching} />
				<div class={styles.formActions}>
					<Button onClick={handleAttach} disabled={!picked} busy={attaching}>
						{attaching ? 'Connecting...' : 'Connect repository'}
					</Button>
				</div>
			</>
		);
	}

	return (
		<div class={styles.form}>
			{body}
			{error && <Notice variant="error" announce>{error}</Notice>}
			{syncing && (
				<SyncProgressDialog
					projectRef={projectRef}
					projectName={project.name}
					onNavigate={handleSyncDone}
					onDismiss={() => handleSyncDone()}
				/>
			)}
		</div>
	);
}
