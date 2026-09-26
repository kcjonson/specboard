import { useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, type ItemModel } from '@specboard/models';
import { FetchError } from '@specboard/fetch';
import { ResizablePanel, Icon } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import { TYPE_LABELS } from '../utils/itemType';
import styles from './ItemDrawer.module.css';

export interface ItemDrawerProps {
	item: ItemModel;
	/**
	 * The item is a row of the board's loaded list, so it is known to exist before
	 * its detail arrives. Any other item is shown only once its own first fetch lands.
	 */
	listed: boolean;
	projectSlug: string;
	/** Upper bound for the drawer width, so it can't fully crowd out the board. */
	maxWidth?: number;
	onClose: () => void;
	onDelete?: (item: ItemModel) => void;
	/** Open a child's detail by key (children are first-class items). */
	onOpenItem?: (itemKey: string) => void;
}

function unresolvedMessage(itemKey: string, error: Error | null): string {
	if (!error) return 'Loading...';
	// Only a real 404 claims the item is gone. Without a status the failure was not
	// an HTTP response at all, so we cannot say.
	return error instanceof FetchError && error.status === 404
		? `${itemKey} couldn't be found. It may have been deleted, or the link may be wrong.`
		: `${itemKey} couldn't be loaded. Close this and try again.`;
}

/**
 * Inline, right-side resizable detail panel for a planning item, shared by the
 * Board and Table views. The content is the same {@link ItemView} used by the
 * full-screen item route; only the surrounding chrome differs.
 */
export function ItemDrawer({ item, listed, projectSlug, maxWidth, onClose, onDelete, onOpenItem }: ItemDrawerProps): JSX.Element {
	useModel(item);

	// An unlisted key has nothing behind it until its fetch lands, and may have
	// nothing behind it at all (deleted, or a dangling link). ItemView over that
	// empty model is a live editor whose Delete and saves act on an item that may
	// not exist, so the panel stays inert until the first fetch succeeds.
	const resolved = listed || item.$meta.lastFetched !== null;
	// Only the FIRST load counts: `$meta.error` is also where a later failed write
	// lands (a rejected move, a save that 409s), and swapping a loaded item for an
	// error message would misreport what happened. Every first-load failure keeps
	// the panel inert, not just a 404: a 500, a timeout, or an expired session
	// leaves an item we could not read just the same. The status decides only
	// what the panel says.
	const loadError = resolved ? null : item.$meta.error;

	// The key doubles as the drawer's identity: it's what you'd paste into a commit or PR.
	const title = resolved ? `${item.key} · ${TYPE_LABELS[item.type || 'epic']}` : item.key;

	const handleOpenInNewWindow = useCallback((): void => {
		window.open(`/projects/${projectSlug}/items/${item.key}`, '_blank', 'noopener,noreferrer');
	}, [projectSlug, item.key]);

	// Close on Escape only when focus is within the drawer; stopPropagation keeps
	// the board's Escape-to-deselect from also firing (so selection is preserved).
	const handleKeyDown = useCallback(
		(e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		},
		[onClose]
	);

	return (
		<ResizablePanel
			storageKey="planning-drawer"
			handleSide="left"
			defaultWidth={420}
			minWidth={320}
			maxWidth={maxWidth}
			label="Resize detail panel"
			class={styles.drawer}
		>
			<div class={styles.inner} onKeyDown={handleKeyDown}>
				<div class={styles.header}>
					<h2 class={styles.title}>{title}</h2>
					<div class={styles.headerActions}>
						{resolved && (
							<button
								type="button"
								class="icon"
								onClick={handleOpenInNewWindow}
								aria-label="Open in new window"
								title="Open in new window"
							>
								<Icon name="external-link" class="size-lg" />
							</button>
						)}
						<button
							type="button"
							class="icon"
							onClick={onClose}
							aria-label="Close"
							title="Close"
						>
							<Icon name="close" class="size-lg" />
						</button>
					</div>
				</div>
				<div class={styles.content}>
					{resolved ? (
						<ItemView item={item} onDelete={onDelete} onOpenItem={onOpenItem} />
					) : (
						<p class={styles.placeholder}>{unresolvedMessage(item.key, loadError)}</p>
					)}
				</div>
			</div>
		</ResizablePanel>
	);
}
