import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { useModel, EpicModel } from '@doc-platform/models';
import { EpicView } from './EpicView';
import styles from './EpicDetail.module.css';

export function EpicDetail({ params }: RouteProps): JSX.Element {
	const epicId = params.id || '';

	// Create and auto-fetch the epic
	const epic = useMemo(() => new EpicModel({ id: epicId }), [epicId]);
	useModel(epic);

	const handleDelete = (): void => {
		epic.delete().then(() => {
			navigate('/');
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
					<a href="/">Back to Board</a>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<div class={styles.content}>
				<nav class={styles.nav}>
					<a href="/" class={styles.backLink}>
						← Back to Board
					</a>
				</nav>
				<EpicView epic={epic} onDelete={handleDelete} />
			</div>
		</div>
	);
}
