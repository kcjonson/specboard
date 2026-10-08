import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Dialog, DialogFooter, Notice } from '@specboard/ui';
import type { GitStatusModel, ChangedFile } from '@specboard/models';
import styles from './DraftConflictsDialog.module.css';

export interface DraftConflictsDialogProps {
	open: boolean;
	gitStatus: GitStatusModel;
	onClose: () => void;
	/** After a draft is kept or discarded, so whatever shows that file reloads it. */
	onResolved: () => void | Promise<void>;
}

/** What the caller did to the file, in the words the row uses. */
function draftLabel(file: ChangedFile): string {
	switch (file.status) {
		case 'deleted':
			return 'You deleted it';
		case 'added':
			return 'You created it';
		default:
			return 'You edited it';
	}
}

interface Versions {
	committed: string | null;
	draft: string | null;
}

/**
 * The caller's drafts made against a committed version someone has changed since. Per
 * file: compare the version committed now with the draft, keep the draft (its base
 * becomes the version committed now), or discard it (back to the committed version).
 */
export function DraftConflictsDialog({ open, gitStatus, onClose, onResolved }: DraftConflictsDialogProps): JSX.Element | null {
	const [comparing, setComparing] = useState<string | null>(null);
	const [versions, setVersions] = useState<Versions | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	if (!open) return null;

	const conflicts = gitStatus.conflictedFiles;

	const toggleCompare = async (path: string): Promise<void> => {
		if (comparing === path) {
			setComparing(null);
			return;
		}
		setComparing(path);
		setVersions(null);
		setLoadError(null);
		try {
			const [committed, draft] = await Promise.all([gitStatus.readCommitted(path), gitStatus.readDraft(path)]);
			setVersions({ committed, draft });
		} catch {
			setLoadError('Could not load both versions.');
		}
	};

	const resolve = async (path: string, action: 'keep' | 'discard'): Promise<void> => {
		setBusy(path);
		const done = action === 'keep' ? await gitStatus.keepMine([path]) : await gitStatus.restore(path);
		setBusy(null);
		if (done) {
			if (comparing === path) setComparing(null);
			await onResolved();
		}
	};

	return (
		<Dialog open={open} onClose={onClose} title="Files changed by someone else" maxWidth="xl">
			{conflicts.length === 0 ? (
				<p class={styles.intro}>Every conflict is resolved. You can commit now.</p>
			) : (
				<>
					<p class={styles.intro}>
						Someone committed changes to these files after you started yours. Your draft
						replaces the whole file, so keeping it drops their changes; discarding it
						drops yours. Compare them first if you want to carry anything over.
					</p>
					{gitStatus.error && <Notice variant="error" announce class={styles.notice}>{gitStatus.error}</Notice>}
					<ul class={styles.list}>
						{conflicts.map((file) => (
							<li key={file.path} class={styles.item}>
								<div class={styles.row}>
									<span class={styles.path}>{file.path}</span>
									<span class={styles.label}>{draftLabel(file)}</span>
									<Button class="secondary size-sm" onClick={() => toggleCompare(file.path)}>
										{comparing === file.path ? 'Hide' : 'Compare'}
									</Button>
									<Button class="secondary size-sm" busy={busy !== null} onClick={() => resolve(file.path, 'keep')}>
										Keep mine
									</Button>
									<Button class="secondary size-sm" busy={busy !== null} onClick={() => resolve(file.path, 'discard')}>
										Discard mine
									</Button>
								</div>
								{comparing === file.path && (
									<div class={styles.compare}>
										{loadError && <p class={styles.error}>{loadError}</p>}
										{!loadError && !versions && <p class={styles.muted}>Loading...</p>}
										{versions && (
											<>
												<section class={styles.side} aria-label="Committed now">
													<h4 class={styles.sideTitle}>Committed now</h4>
													{versions.committed === null
														? <p class={styles.muted}>Deleted from the repository.</p>
														: <pre class={styles.content}>{versions.committed}</pre>}
												</section>
												<section class={styles.side} aria-label="Your draft">
													<h4 class={styles.sideTitle}>Your draft</h4>
													{versions.draft === null
														? <p class={styles.muted}>You deleted this file.</p>
														: <pre class={styles.content}>{versions.draft}</pre>}
												</section>
											</>
										)}
									</div>
								)}
							</li>
						))}
					</ul>
				</>
			)}
			<DialogFooter>
				<Button class="primary" onClick={onClose}>Close</Button>
			</DialogFooter>
		</Dialog>
	);
}
