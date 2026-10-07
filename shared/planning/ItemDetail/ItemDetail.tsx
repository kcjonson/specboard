import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { formatProjectRef } from '@specboard/core/identifiers';
import { navigate } from '@specboard/router';
import { useModel, useProjectRole, ItemModel, writeFailure } from '@specboard/models';
import { Icon, Notice, Page } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import styles from './ItemDetail.module.css';

export function ItemDetail({ params }: RouteProps): JSX.Element {
	const projectRef = formatProjectRef(params.owner!, params.project!);
	const itemKey = (params.itemKey || '').toUpperCase();

	// Model auto-fetches when given a key
	const item = useMemo(() => new ItemModel({ key: itemKey, projectRef }), [itemKey, projectRef]);
	useModel(item);
	const { canEdit } = useProjectRole(projectRef);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const handleDelete = (): void => {
		setDeleteError(null);
		item.delete().then(
			() => navigate(`/projects/${projectRef}/planning`),
			(err: unknown) => setDeleteError(writeFailure(err, 'Could not delete this item.', projectRef))
		);
	};

	// Loading state - show while fetching and data hasn't arrived yet
	if (!item.$meta.lastFetched && !item.$meta.error) {
		return (
			<Page projectRef={projectRef} activeTab="Planning">
				<div class={styles.container}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</Page>
		);
	}

	// A first load that failed. `$meta.error` is also where a later refused write lands
	// (a save, a delete), and those are reported beside the item rather than replacing it.
	if (!item.$meta.lastFetched && item.$meta.error) {
		return (
			<Page projectRef={projectRef} activeTab="Planning">
				<div class={styles.container}>
					<div class={styles.error}>
						<p>Error: {item.$meta.error.message}</p>
						<a href={`/projects/${projectRef}/planning`}>Back to Board</a>
					</div>
				</div>
			</Page>
		);
	}

	return (
		<Page projectRef={projectRef} activeTab="Planning">
			<div class={styles.container}>
				<nav class={styles.nav}>
					<a href={`/projects/${projectRef}/planning`} class={styles.backLink}>
						<Icon name="arrow-left" class="size-sm" /> Back to Board
					</a>
				</nav>
				{deleteError && (
					<div role="alert">
						<Notice variant="error">{deleteError}</Notice>
					</div>
				)}
				<div class={styles.content}>
					<ItemView
						item={item}
						canEdit={canEdit}
						onDelete={handleDelete}
						onOpenItem={(childKey) => navigate(`/projects/${projectRef}/items/${childKey}`)}
					/>
				</div>
			</div>
		</Page>
	);
}
