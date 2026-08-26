import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { useModel, ItemModel } from '@specboard/models';
import { Icon, Page } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import styles from './ItemDetail.module.css';

export function ItemDetail({ params }: RouteProps): JSX.Element {
	const projectSlug = params.projectSlug || 'demo';
	const itemKey = (params.itemKey || '').toUpperCase();

	// Model auto-fetches when given a key
	const item = useMemo(() => new ItemModel({ key: itemKey, projectSlug }), [itemKey, projectSlug]);
	useModel(item);

	const handleDelete = (): void => {
		item.delete().then(() => {
			navigate(`/projects/${projectSlug}/planning`);
		});
	};

	// Loading state - show while fetching and data hasn't arrived yet
	if (!item.$meta.lastFetched && !item.$meta.error) {
		return (
			<Page projectSlug={projectSlug} activeTab="Planning">
				<div class={styles.container}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</Page>
		);
	}

	// Error state
	if (item.$meta.error) {
		return (
			<Page projectSlug={projectSlug} activeTab="Planning">
				<div class={styles.container}>
					<div class={styles.error}>
						<p>Error: {item.$meta.error.message}</p>
						<a href={`/projects/${projectSlug}/planning`}>Back to Board</a>
					</div>
				</div>
			</Page>
		);
	}

	return (
		<Page projectSlug={projectSlug} activeTab="Planning">
			<div class={styles.container}>
				<nav class={styles.nav}>
					<a href={`/projects/${projectSlug}/planning`} class={styles.backLink}>
						<Icon name="arrow-left" class="size-sm" /> Back to Board
					</a>
				</nav>
				<div class={styles.content}>
					<ItemView
						item={item}
						onDelete={handleDelete}
						onOpenChild={(childKey) => navigate(`/projects/${projectSlug}/items/${childKey}`)}
					/>
				</div>
			</div>
		</Page>
	);
}
