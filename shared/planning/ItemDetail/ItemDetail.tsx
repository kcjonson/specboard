import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { useModel, ItemModel } from '@specboard/models';
import { Icon } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import styles from './ItemDetail.module.css';

export function ItemDetail({ params }: RouteProps): JSX.Element {
	const projectId = params.projectId || 'demo';
	const itemId = params.id || '';

	// Model auto-fetches when given an id
	const item = useMemo(() => new ItemModel({ id: itemId, projectId }), [itemId, projectId]);
	useModel(item);

	const handleDelete = (): void => {
		item.delete().then(() => {
			navigate(`/projects/${projectId}/planning`);
		});
	};

	// Loading state - show while fetching and data hasn't arrived yet
	if (!item.$meta.lastFetched && !item.$meta.error) {
		return (
			<div class={styles.container}>
				<div class={styles.loading}>Loading...</div>
			</div>
		);
	}

	// Error state
	if (item.$meta.error) {
		return (
			<div class={styles.container}>
				<div class={styles.error}>
					<p>Error: {item.$meta.error.message}</p>
					<a href={`/projects/${projectId}/planning`}>Back to Board</a>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<nav class={styles.nav}>
				<a href={`/projects/${projectId}/planning`} class={styles.backLink}>
					<Icon name="arrow-left" class="size-sm" /> Back to Board
				</a>
			</nav>
			<div class={styles.content}>
				<ItemView item={item} onDelete={handleDelete} />
			</div>
		</div>
	);
}
