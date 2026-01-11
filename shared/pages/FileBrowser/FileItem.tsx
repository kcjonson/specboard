import type { JSX, RefObject } from 'preact';
import { Icon } from '@doc-platform/ui';
import { FileStatus, type FileChangeStatus } from './FileStatus';
import styles from './FileBrowser.module.css';

export interface FileItemProps {
	/** File path */
	path: string;
	/** File name */
	name: string;
	/** Depth in tree (for indentation) */
	depth: number;
	/** Whether this file is selected */
	isSelected: boolean;
	/** Whether this file is being renamed */
	isRenaming: boolean;
	/** Current rename input value */
	renameValue: string;
	/** Ref for rename input */
	renameInputRef: RefObject<HTMLInputElement>;
	/** Git change status */
	changeStatus?: FileChangeStatus;
	/** Whether file is deleted in git */
	isDeleted: boolean;
	/** Called when file is clicked */
	onClick: () => void;
	/** Called when file is double-clicked (to start rename) */
	onDoubleClick: (e: Event) => void;
	/** Called when rename input changes */
	onRenameInput: (e: Event) => void;
	/** Called on rename input keydown */
	onRenameKeyDown: (e: KeyboardEvent) => void;
	/** Called on rename input blur */
	onRenameBlur: () => void;
	/** Called when delete button is clicked */
	onDeleteClick: (e: Event) => void;
}

export function FileItem({
	name,
	depth,
	isSelected,
	isRenaming,
	renameValue,
	renameInputRef,
	changeStatus,
	isDeleted,
	onClick,
	onDoubleClick,
	onRenameInput,
	onRenameKeyDown,
	onRenameBlur,
	onDeleteClick,
}: FileItemProps): JSX.Element {
	return (
		<div
			class={`${styles.treeItem} ${isSelected ? styles.selected : ''} ${isDeleted ? styles.deleted : ''}`}
			style={{ '--depth': String(depth) } as JSX.CSSProperties}
			onClick={onClick}
			onDblClick={onDoubleClick}
		>
			<span class={styles.fileIcon}>
				<Icon name="file" class="size-sm" />
			</span>
			{isRenaming ? (
				<input
					ref={renameInputRef}
					type="text"
					class={styles.newFileInput}
					value={renameValue}
					onInput={onRenameInput}
					onKeyDown={onRenameKeyDown}
					onBlur={onRenameBlur}
					placeholder="filename.md"
					aria-label="Rename file"
				/>
			) : (
				<span class={styles.fileName}>{name}</span>
			)}
			{!isRenaming && (
				<div class={styles.fileActions}>
					{changeStatus && <FileStatus status={changeStatus} />}
					<button
						class={styles.deleteButton}
						onClick={onDeleteClick}
						title="Delete file"
						aria-label="Delete file"
					>
						<Icon name="trash-2" class="size-xs" />
					</button>
				</div>
			)}
		</div>
	);
}
