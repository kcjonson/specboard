import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { useModel, EpicModel } from '@doc-platform/models';
import { Icon } from '@doc-platform/ui';
import { EpicView } from '../EpicView/EpicView';
import styles from './EpicDetail.module.css';

export function EpicDetail({ params }: RouteProps): JSX.Element {
	const projectId = params.projectId || 'demo';
	const epicId = params.id || '';

	// Model auto-fetches when given an id
	const epic = useMemo(() => new EpicModel({ id: epicId, projectId }), [epicId, projectId]);
	useModel(epic);

	const handleDelete = (): void => {
		epic.delete().then(() => {
			navigate(`/projects/${projectId}/planning`);
		});
	};

	// Loading state
	if (epic.$meta.working && !epic.title) {
		return (
			<div class={styles.container}>
				<div class={styles.loading}>Loading...</div>
			</div>
		);
	}

	// Error state
	if (epic.$meta.error) {
		return (
			<div class={styles.container}>
				<div class={styles.error}>
					<p>Error: {epic.$meta.error.message}</p>
					<a href={`/projects/${projectId}/planning`}>Back to Board</a>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<div class={styles.content}>
				<nav class={styles.nav}>
					<a href={`/projects/${projectId}/planning`} class={styles.backLink}>
						<Icon name="arrow-left" class="size-sm" /> Back to Board
					</a>
				</nav>
				<EpicView epic={epic} onDelete={handleDelete} />
			</div>
		</div>
	);
}
