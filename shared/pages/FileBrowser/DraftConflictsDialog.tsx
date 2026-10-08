import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, ConfirmDialog, Dialog, DialogFooter, Notice } from '@specboard/ui';
import type { GitStatusModel, ChangedFile } from '@specboard/models';
import styles from './DraftConflictsDialog.module.css';

export interface DraftConflictsDialogProps {
	open: boolean;
	gitStatus: GitStatusModel;
	onClose: () => void;
	/** Before a draft is kept or discarded: save it if it's the open file. */
	onBeforeResolve?: (path: string) => Promise<void>;
	/** After a draft is kept or discarded, so whatever shows that file reloads it. */
	onResolved?: (path: string) => void | Promise<void>;
	/** After a rename is undone: the file is back at oldPath and newPath is gone. */
	onRenameUndone?: (oldPath: string, newPath: string) => void | Promise<void>;
}

/** How the row describes what the caller did, and what its two actions are called. */
function describe(file: ChangedFile): { did: string; keep: string; discard: string } {
	if (file.status === 'deleted' && file.renamedTo) {
		const did = file.renameKeepsCommitted
			? `You renamed it; ${file.renamedTo} has their latest version`
			: `You renamed it to ${file.renamedTo}`;
		return { did, keep: 'Keep my rename', discard: 'Undo my rename' };
	}
	switch (file.status) {
		case 'deleted':
			return { did: 'You deleted it', keep: 'Keep it deleted', discard: 'Discard my deletion' };
		case 'added':
			return { did: 'You created it', keep: 'Keep mine', discard: 'Discard mine' };
		default:
			return { did: 'You edited it', keep: 'Keep mine', discard: 'Discard mine' };
	}
}

/** What discarding gives up, for the confirmation. */
function discardWarning(file: ChangedFile): string {
	if (file.status === 'deleted' && file.renamedTo) {
		return `${file.path} comes back as it's committed, and your copy at ${file.renamedTo} is discarded with any edits in it.`;
	}
	if (file.status === 'deleted') return `${file.path} comes back as it's committed now.`;
	return `Your changes to ${file.path} are discarded and the committed version takes their place.`;
}

interface Versions {
	path: string;
	committed: string | null;
	draft: string | null;
}

/** An id-safe form of a path, for aria-controls. */
function regionId(path: string): string {
	return `conflict-compare-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

/**
 * The caller's drafts made against a committed version someone has changed since. Per
 * file: compare the version committed now with the draft, keep the draft (its base
 * becomes the version committed now), or discard it (back to the committed version).
 */
export function DraftConflictsDialog({
	open,
	gitStatus,
	onClose,
	onBeforeResolve,
	onResolved,
	onRenameUndone,
}: DraftConflictsDialogProps): JSX.Element | null {
	const [comparing, setComparing] = useState<string | null>(null);
	const [versions, setVersions] = useState<Versions | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	// The rows with a keep or discard in flight; each clears only itself.
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [confirmDiscard, setConfirmDiscard] = useState<ChangedFile | null>(null);
	// The row whose position should take focus once a resolution re-renders the list.
	const [focusAt, setFocusAt] = useState<number | null>(null);
	const compareRequest = useRef(0);
	const listRef = useRef<HTMLUListElement>(null);
	const closeRef = useRef<HTMLDivElement>(null);

	const conflicts = gitStatus.conflictedFiles;

	useEffect(() => {
		if (focusAt === null) return;
		const firstActions = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-first-action] button') ?? [];
		const next = firstActions[Math.min(focusAt, firstActions.length - 1)];
		(next ?? closeRef.current?.querySelector<HTMLButtonElement>('button'))?.focus();
		setFocusAt(null);
	}, [focusAt, conflicts.length]);

	if (!open) return null;

	const toggleCompare = async (file: ChangedFile): Promise<void> => {
		const path = file.path;
		if (comparing === path) {
			setComparing(null);
			return;
		}
		const request = ++compareRequest.current;
		setComparing(path);
		setVersions(null);
		setLoadError(null);
		try {
			// A rename's draft lives at the new path: compare the old file as committed
			// now with what the caller has there.
			const [committed, draft] = await Promise.all([
				gitStatus.readCommitted(path),
				gitStatus.readDraft(file.renamedTo ?? path),
			]);
			// A slower answer for a row since closed or replaced shows nowhere.
			if (request === compareRequest.current) setVersions({ path, committed, draft });
		} catch {
			if (request === compareRequest.current) setLoadError('Could not load both versions.');
		}
	};

	const resolve = async (file: ChangedFile, action: 'keep' | 'discard'): Promise<void> => {
		const index = conflicts.findIndex((f) => f.path === file.path);
		const undoingRename = action === 'discard' && file.status === 'deleted' && file.renamedTo !== undefined;
		setBusy((rows) => new Set(rows).add(file.path));
		setActionError(null);
		let done: boolean;
		try {
			try {
				await onBeforeResolve?.(undoingRename ? file.renamedTo! : file.path);
			} catch (err) {
				setActionError(err instanceof Error ? err.message : 'Couldn\'t save first, so nothing was changed.');
				return;
			}
			if (action === 'keep') {
				done = await gitStatus.keepMine([file.path]);
			} else if (undoingRename) {
				done = await gitStatus.undoRename(file.path, file.renamedTo!);
			} else {
				done = await gitStatus.restore(file.path);
			}
		} finally {
			setBusy((rows) => {
				const next = new Set(rows);
				next.delete(file.path);
				return next;
			});
		}
		if (done) {
			if (comparing === file.path) setComparing(null);
			if (undoingRename) await onRenameUndone?.(file.path, file.renamedTo!);
			else await onResolved?.(file.path);
			setFocusAt(index);
		}
	};

	const confirmAndDiscard = async (): Promise<void> => {
		const file = confirmDiscard;
		setConfirmDiscard(null);
		if (file) await resolve(file, 'discard');
	};

	return (
		<Dialog open={open} onClose={onClose} title="Files changed by someone else" maxWidth="xl">
			{conflicts.length === 0 ? (
				<p class={styles.intro}>Every conflict is resolved. You can commit now.</p>
			) : (
				<>
					<p class={styles.intro}>
						Someone committed changes to these files after you started yours. Your draft
						replaces the whole file, so keeping it drops their changes unless it already
						has them; discarding it drops yours. Compare them first if you want to carry
						anything over.
					</p>
					{(actionError ?? gitStatus.error) && (
						<Notice variant="error" announce class={styles.notice}>{actionError ?? gitStatus.error}</Notice>
					)}
					<ul class={styles.list} ref={listRef}>
						{conflicts.map((file) => {
							const copy = describe(file);
							const isComparing = comparing === file.path;
							const rowBusy = busy.has(file.path);
							return (
								<li key={file.path} class={styles.item}>
									<div class={styles.row}>
										<span class={styles.path}>{file.path}</span>
										<span class={styles.label}>{copy.did}</span>
										<span data-first-action>
											<Button
												class="secondary size-sm"
												aria-label={`Compare versions of ${file.path}`}
												aria-expanded={isComparing}
												aria-controls={regionId(file.path)}
												onClick={() => toggleCompare(file)}
											>
												{isComparing ? 'Hide' : 'Compare'}
											</Button>
										</span>
										<Button
											class="secondary size-sm"
											busy={rowBusy}
											aria-label={`${copy.keep}: ${file.path}`}
											onClick={() => resolve(file, 'keep')}
										>
											{copy.keep}
										</Button>
										<Button
											class="secondary size-sm"
											busy={rowBusy}
											aria-label={`${copy.discard}: ${file.path}`}
											onClick={() => setConfirmDiscard(file)}
										>
											{copy.discard}
										</Button>
									</div>
									<div id={regionId(file.path)} class={styles.compare} hidden={!isComparing}>
										{isComparing && loadError && <p class={styles.error}>{loadError}</p>}
										{isComparing && !loadError && versions?.path !== file.path && <p class={styles.muted}>Loading...</p>}
										{isComparing && versions?.path === file.path && (
											<>
												<section class={styles.side} aria-label={`Committed now: ${file.path}`}>
													<h4 class={styles.sideTitle}>Committed now</h4>
													{versions.committed === null
														? <p class={styles.muted}>Deleted from the repository.</p>
														: <pre class={styles.content}>{versions.committed}</pre>}
												</section>
												<section class={styles.side} aria-label={`Your draft: ${file.renamedTo ?? file.path}`}>
													<h4 class={styles.sideTitle}>{file.renamedTo ? `Your draft at ${file.renamedTo}` : 'Your draft'}</h4>
													{versions.draft === null
														? <p class={styles.muted}>You deleted this file.</p>
														: <pre class={styles.content}>{versions.draft}</pre>}
												</section>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				</>
			)}
			<div ref={closeRef}>
				<DialogFooter>
					<Button class="primary" onClick={onClose}>Close</Button>
				</DialogFooter>
			</div>
			<ConfirmDialog
				open={confirmDiscard !== null}
				title={confirmDiscard ? describe(confirmDiscard).discard : 'Discard'}
				message="This can't be undone."
				warning={confirmDiscard ? discardWarning(confirmDiscard) : undefined}
				confirmText={confirmDiscard ? describe(confirmDiscard).discard : 'Discard'}
				confirmVariant="danger"
				cancelText="Cancel"
				onConfirm={confirmAndDiscard}
				onCancel={() => setConfirmDiscard(null)}
			/>
		</Dialog>
	);
}
