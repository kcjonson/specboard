import { useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, type ItemModel, type ItemType } from '@specboard/models';
import { ResizablePanel, Icon } from '@specboard/ui';
import { ItemView } from '../ItemView/ItemView';
import styles from './ItemDrawer.module.css';

const TYPE_LABELS: Record<ItemType, string> = {
	epic: 'Epic',
	task: 'Task',
	bug: 'Bug',
};

export interface ItemDrawerProps {
	item: ItemModel;
	projectSlug: string;
	/** Upper bound for the drawer width, so it can't fully crowd out the board. */
	maxWidth?: number;
	onClose: () => void;
	onDelete?: (item: ItemModel) => void;
	/** Open a child's detail by key (children are first-class items). */
	onOpenItem?: (itemKey: string) => void;
}

/**
 * Inline, right-side resizable detail panel for a planning item — the non-modal
 * replacement for the old centered ItemDialog. Shared by both the Board and the
 * Table views (Planning renders one drawer for the currently selected item).
 *
 * The content is the same {@link ItemView} used by the create modal and the
 * full-screen item route; only the surrounding chrome (resize handle, header)
 * differs.
 */
export interface MissingItemDrawerProps {
	/** The key from the route that didn't resolve. */
	itemKey: string;
	onClose: () => void;
}

/**
 * Shown in place of the drawer when the route names an item that doesn't resolve —
 * a stale link, or one deleted while the page was open. Rendering the normal drawer
 * for a failed fetch gives an empty but *editable* panel, whose Save and Delete act
 * on an item that isn't there.
 */
export function MissingItemDrawer({ itemKey, onClose }: MissingItemDrawerProps): JSX.Element {
	return (
		<ResizablePanel
			storageKey="planning-drawer"
			handleSide="left"
			defaultWidth={420}
			minWidth={320}
			label="Resize detail panel"
			class={styles.drawer}
		>
			<div class={styles.inner}>
				<div class={styles.header}>
					<h2 class={styles.title}>{itemKey}</h2>
					<div class={styles.headerActions}>
						<button type="button" class="icon" onClick={onClose} aria-label="Close" title="Close">
							<Icon name="close" class="size-lg" />
						</button>
					</div>
				</div>
				<div class={styles.content}>
					<p class={styles.missing}>
						{itemKey} couldn&apos;t be found. It may have been deleted, or the link may be wrong.
					</p>
				</div>
			</div>
		</ResizablePanel>
	);
}

export function ItemDrawer({ item, projectSlug, maxWidth, onClose, onDelete, onOpenItem }: ItemDrawerProps): JSX.Element {
	// Subscribe so the header title updates once a lazily-opened item finishes loading.
	useModel(item);
	// The key doubles as the drawer's identity — it's what you'd paste into a commit or PR.
	const title = item.key ? `${item.key} · ${TYPE_LABELS[item.type || 'epic']}` : `Edit ${TYPE_LABELS[item.type || 'epic']}`;

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
						<button
							type="button"
							class="icon"
							onClick={handleOpenInNewWindow}
							aria-label="Open in new window"
							title="Open in new window"
						>
							<Icon name="external-link" class="size-lg" />
						</button>
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
					<ItemView item={item} onDelete={onDelete} onOpenChild={onOpenItem} />
				</div>
			</div>
		</ResizablePanel>
	);
}
