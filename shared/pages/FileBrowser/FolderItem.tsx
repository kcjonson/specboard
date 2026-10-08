import type { JSX } from 'preact';
import { Icon } from '@specboard/ui';
import { ConflictMark } from './FileStatus';
import styles from './FileBrowser.module.css';

export interface FolderItemProps {
	/** Folder name */
	name: string;
	/** Depth in tree (for indentation) */
	depth: number;
	/** Whether folder is expanded */
	isExpanded: boolean;
	/** Whether this is a root folder */
	isRoot: boolean;
	/** No add, delete or remove buttons, for someone who can't edit */
	readOnly?: boolean;
	/** Whether a root folder can be removed from the project, which only the owner may do */
	canRemove?: boolean;
	/** A draft at or under this folder conflicts with a newer commit; marked while collapsed */
	hasConflict?: boolean;
	/** Called when folder is clicked (to toggle expand) */
	onClick: () => void;
	/** Called when add file button is clicked */
	onAddFileClick: (e: Event) => void;
	/** Called when delete button is clicked (non-root only) */
	onDeleteClick: (e: Event) => void;
	/** Called when remove button is clicked (root only) */
	onRemoveClick: (e: Event) => void;
}

export function FolderItem({
	name,
	depth,
	isExpanded,
	isRoot,
	readOnly = false,
	canRemove = false,
	hasConflict = false,
	onClick,
	onAddFileClick,
	onDeleteClick,
	onRemoveClick,
}: FolderItemProps): JSX.Element {
	return (
		<div
			class={`${styles.treeItem} ${styles.folderItem}`}
			style={{ '--depth': String(depth) } as JSX.CSSProperties}
			onClick={onClick}
		>
			<span class={styles.folderIcon}>
				<Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} class="size-xs" />
				<Icon name={isExpanded ? 'folder-open' : 'folder'} class="size-sm" />
			</span>
			<span class={styles.fileName}>{name}</span>
			{hasConflict && !isExpanded && (
				<ConflictMark label={`${name} has files someone else changed since your drafts began`} />
			)}
			{!readOnly && (
				<div class={styles.folderActions}>
					<button
						class={styles.addFileButton}
						onClick={onAddFileClick}
						title="New file in folder"
						aria-label="New file in folder"
					>
						<Icon name="plus" class="size-xs" />
					</button>
					{!isRoot && (
						<button
							class={styles.deleteButton}
							onClick={onDeleteClick}
							title="Delete folder"
							aria-label="Delete folder"
						>
							<Icon name="trash-2" class="size-xs" />
						</button>
					)}
					{isRoot && canRemove && (
						<button
							class={styles.removeButton}
							onClick={onRemoveClick}
							title="Remove folder from project"
							aria-label="Remove folder from project"
						>
							<Icon name="x" class="size-xs" />
						</button>
					)}
				</div>
			)}
		</div>
	);
}
