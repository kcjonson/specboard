import { useState, useMemo, useCallback, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, ChecklistCollection, type ChecklistEntryModel } from '@specboard/models';
import { Button, Checkbox, Text } from '@specboard/ui';
import styles from './ChecklistSection.module.css';

export interface ChecklistSectionProps {
	projectSlug: string;
	itemKey: string;
}

/**
 * An item's checklist: ordered scratch todos, on any item type. An entry is
 * text and a status and nothing else — no key, no board status, no history. A line
 * that earns any of those is a child item instead.
 *
 * Unlike blockers there is no onChange: nothing the server derives (an item's
 * status, its blocked flag) reads the checklist, so a write here never leaves
 * the rest of the drawer stale.
 */
export function ChecklistSection({ projectSlug, itemKey }: ChecklistSectionProps): JSX.Element {
	const checklist = useMemo(() => new ChecklistCollection({ projectSlug, itemKey }), [projectSlug, itemKey]);
	useModel(checklist);

	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	// Double-Enter would otherwise append the same entry twice before the first
	// request settles.
	const [busy, setBusy] = useState(false);
	// The row being renamed, so a re-render (a sibling's toggle emits one) can't
	// reset the field under the typing. Only one row is edited at a time.
	const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

	const entries = checklist.toArray();
	const done = entries.filter((entry) => entry.status === 'done').length;

	const handleAdd = useCallback(async (): Promise<void> => {
		const value = draft.trim();
		if (!value || busy) return;
		setError(null);
		setBusy(true);
		try {
			await checklist.add({ text: value });
			setDraft('');
		} catch {
			setError('Could not add that item.');
		} finally {
			setBusy(false);
		}
	}, [checklist, draft, busy]);

	const handleDraftKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			void handleAdd();
		} else if (e.key === 'Escape' && draft.trim() !== '') {
			// The drawer this can sit inside closes on Escape, which would take a
			// half-typed entry with it. Only a draft is worth swallowing the key for:
			// with the field already empty it falls through and the drawer closes, so
			// a second Escape still gets out.
			e.stopPropagation();
			setDraft('');
		}
	};

	// Entries with a toggle in flight. patch() applies the response it gets back,
	// so two overlapping writes can land out of order and leave the box showing
	// the older answer. One at a time per entry; the second click is dropped
	// rather than queued, because the user is looking at an optimistic box that
	// already shows what they asked for.
	const togglingRef = useRef<Set<string>>(new Set());

	const handleToggle = useCallback(async (entry: ChecklistEntryModel): Promise<void> => {
		if (togglingRef.current.has(entry.id)) return;
		togglingRef.current.add(entry.id);
		setError(null);
		// Optimistic: the box moves under the pointer, and reverts if the write fails.
		const previous = entry.status;
		const next = previous === 'done' ? 'todo' : 'done';
		entry.status = next;
		try {
			// patch, not save: save() would PUT this client's copy of the text too.
			await entry.patch({ status: next });
		} catch {
			entry.status = previous;
			setError('Could not save that item.');
		} finally {
			togglingRef.current.delete(entry.id);
		}
	}, []);

	const handleRename = useCallback(async (entry: ChecklistEntryModel, value: string): Promise<void> => {
		const trimmed = value.trim();
		// Blanking the field is not a delete; Remove is. Reverting beats a 400.
		if (!trimmed || trimmed === entry.text) return;
		setError(null);
		const previous = entry.text;
		entry.text = trimmed;
		try {
			await entry.patch({ text: trimmed });
		} catch {
			entry.text = previous;
			setError('Could not save that item.');
		}
	}, []);

	const handleRemove = useCallback(async (entry: ChecklistEntryModel): Promise<void> => {
		setError(null);
		try {
			await checklist.remove(entry);
		} catch {
			setError('Could not remove that item.');
		}
	}, [checklist]);

	const renderRow = (entry: ChecklistEntryModel): JSX.Element => {
		const value = editing?.id === entry.id ? editing.value : entry.text;
		const commit = (field: HTMLInputElement): void => {
			setEditing(null);
			void handleRename(entry, field.value);
		};
		return (
			<div key={entry.id} class={styles.row} role="listitem">
				{/* The box's own label is empty because the row's text is an editable
				    field: as the label it would be a click target that toggles the entry
				    instead of placing a caret. The name moves to aria-label. */}
				<Checkbox
					checked={entry.status === 'done'}
					label=""
					ariaLabel={entry.text}
					onChange={() => void handleToggle(entry)}
				/>
				<input
					type="text"
					class={entry.status === 'done' ? `${styles.text} ${styles.doneText}` : styles.text}
					value={value}
					aria-label={`Edit "${entry.text}"`}
					onInput={(e) => setEditing({ id: entry.id, value: (e.target as HTMLInputElement).value })}
					onBlur={(e) => commit(e.currentTarget as HTMLInputElement)}
					onKeyDown={(e: KeyboardEvent) => {
						const field = e.currentTarget as HTMLInputElement;
						if (e.key === 'Enter') {
							field.blur();
						} else if (e.key === 'Escape' && field.value !== entry.text) {
							// Escape closes the innermost thing with something to dismiss:
							// an unsaved rename here, the drawer once there isn't one. The
							// DOM value is reset first so the blur that follows sees no
							// change and writes nothing.
							e.stopPropagation();
							setEditing(null);
							field.value = entry.text;
							field.blur();
						}
					}}
				/>
				<Button class="text" onClick={() => void handleRemove(entry)}>
					Remove
				</Button>
			</div>
		);
	};

	// A checklist that failed to load is not an empty checklist.
	const renderList = (): JSX.Element => {
		if (checklist.$meta.error) {
			return <div class={styles.error}>Could not load the checklist.</div>;
		}
		if (entries.length === 0) {
			return <p class={styles.placeholder}>Nothing on the checklist</p>;
		}
		return (
			<div class={styles.list} role="list">
				{entries.map(renderRow)}
			</div>
		);
	};

	return (
		<section class={styles.section}>
			<h3 class={styles.sectionTitle}>
				{entries.length === 0 ? 'Checklist' : `Checklist (${done}/${entries.length})`}
			</h3>

			{renderList()}

			{error && <div class={styles.error}>{error}</div>}

			<div class={styles.addRow}>
				<Text
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					onKeyDown={handleDraftKeyDown}
					placeholder="Add a checklist item..."
					ariaLabel="Add a checklist item"
					compact
				/>
				<Button class="text" onClick={() => void handleAdd()} disabled={!draft.trim() || busy}>
					+ Add
				</Button>
			</div>
		</section>
	);
}
