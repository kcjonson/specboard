import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, NotesCollection } from '@specboard/models';
import { Button, Text } from '@specboard/ui';
import { formatTimeAgo } from '../utils/time';
import { actorLabel } from '../utils/actor';
import styles from './NotesSection.module.css';

export interface NotesSectionProps {
	projectSlug: string;
	itemKey: string;
}

/**
 * An item's activity log: append-only entries written here or by an agent
 * through the MCP. Newest first, in the order the server returns them.
 */
export function NotesSection({ projectSlug, itemKey }: NotesSectionProps): JSX.Element {
	const notes = useMemo(() => new NotesCollection({ projectSlug, itemKey }), [projectSlug, itemKey]);
	useModel(notes);

	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	// Double-Enter would otherwise post the same entry twice before the first
	// request settles.
	const [busy, setBusy] = useState(false);

	const handleAdd = useCallback(async (): Promise<void> => {
		const value = draft.trim();
		if (!value || busy) return;
		setError(null);
		setBusy(true);
		try {
			await notes.add({ note: value });
			setDraft('');
			// add() appends, which would park the newest entry at the bottom of a
			// newest-first log; refetching restores the server's order. Forced, because
			// a poll already in flight was answered before the POST and would reconcile
			// the new entry straight back out.
			//
			// fetch() never throws: a refetch that fails leaves the entry sitting at the
			// bottom with no error shown. Accepted — the entry did save, and the next
			// successful fetch reorders it.
			await notes.fetch({ force: true });
		} catch {
			setError('Could not add that note.');
		} finally {
			setBusy(false);
		}
	}, [notes, draft, busy]);

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			void handleAdd();
		} else if (e.key === 'Escape') {
			setDraft('');
		}
	};

	// A failed GET must not read as an empty log, and neither should the gap before
	// the first response lands.
	const renderLog = (): JSX.Element | null => {
		if (notes.$meta.error) {
			return <div class={styles.error}>Could not load the activity log.</div>;
		}
		if (!notes.$meta.lastFetched) {
			return <p class={styles.placeholder}>Loading...</p>;
		}
		if (notes.length === 0) {
			return <p class={styles.placeholder}>No activity yet</p>;
		}
		return (
			<div class={styles.list} role="list">
				{notes.map((entry) => (
					<div key={entry.id} class={styles.entry} role="listitem">
						<div class={styles.meta}>
							{entry.actor && <span class={styles.actor}>{actorLabel(entry.actor)}</span>}
							<span class={styles.time}>{formatTimeAgo(entry.createdAt)}</span>
						</div>
						<p class={styles.body}>{entry.note}</p>
					</div>
				))}
			</div>
		);
	};

	return (
		<section class={styles.section}>
			<h3 class={styles.sectionTitle}>Activity</h3>

			<div class={styles.addRow}>
				<Text
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					onKeyDown={handleKeyDown}
					placeholder="Add a note..."
					ariaLabel="Add a note"
					compact
				/>
				<Button class="text" onClick={() => void handleAdd()} disabled={!draft.trim() || busy}>
					+ Add
				</Button>
			</div>

			{error && <div class={styles.error}>{error}</div>}

			{renderLog()}
		</section>
	);
}
