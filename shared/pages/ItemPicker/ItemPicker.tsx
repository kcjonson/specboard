import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient } from '@specboard/fetch';
import type { ItemStatus, ItemType } from '@specboard/models';
import { Dialog, Text, STATUS_LABELS } from '@specboard/ui';
import styles from './ItemPicker.module.css';

/**
 * Rows requested per query. The server orders by rank, not by relevance, so a
 * tight limit would cut the best match rather than the least interesting one;
 * this is deliberately generous for a list nobody scrolls to the bottom of.
 */
const PICKER_LIMIT = 100;

/**
 * How long the search box sits still before its text becomes a new query, matching
 * the board's toolbar. The list endpoint has its own rate-limit bucket, and a
 * keystroke-per-request picker is exactly what put it there.
 */
const SEARCH_DEBOUNCE = 250;

/** The fields the picker renders off a row from the list endpoint. */
interface PickerItem {
	id: string;
	key: string;
	title: string;
	status: ItemStatus;
}

export interface ItemPickerProps {
	projectSlug: string;
	/** Dialog heading, since the same list answers different questions. */
	title: string;
	/** Restrict the list to one item type, or undefined for all of them. */
	type?: ItemType;
	/**
	 * A row that picks no item at all ("No parent"). Present only where selecting
	 * nothing is a real answer, so the picker never offers a no-op.
	 */
	clearOption?: { label: string; onSelect: () => void };
	/** Called with the chosen item's key (e.g. SB-345). */
	onSelect: (itemKey: string) => void;
	onClose: () => void;
}

/**
 * Modal list of the project's items, for choosing one to link or to nest under.
 *
 * Search runs on the server, one request per settled keystroke, rather than over a
 * preloaded page: the board can hold thousands of items and an item you can't find
 * is an item you can't pick. Deliberately not an ItemsCollection — that fires one
 * request per status window (five per keystroke), and it is the board's model, not
 * a scratch list.
 */
export function ItemPicker({ projectSlug, title, type, clearOption, onSelect, onClose }: ItemPickerProps): JSX.Element {
	const [search, setSearch] = useState('');
	const [settledSearch, setSettledSearch] = useState('');
	const [items, setItems] = useState<PickerItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (search === settledSearch) return;
		// Emptying the box is one deliberate act, not a keystroke on the way to
		// another: settle it now rather than leaving the results the user just
		// cleared on screen for another quarter second.
		if (search.trim() === '') {
			setSettledSearch(search);
			return;
		}
		const timer = setTimeout(() => setSettledSearch(search), SEARCH_DEBOUNCE);
		return () => clearTimeout(timer);
	}, [search, settledSearch]);

	useEffect(() => {
		const params = new URLSearchParams({ limit: String(PICKER_LIMIT) });
		if (type) params.set('type', type);
		const query = settledSearch.trim();
		// A non-empty search drops the server's top-level-only restriction, so typing
		// reaches nested items while the opening list stays the top-level set. That
		// asymmetry is the intended shape here: nesting under a top-level item is the
		// ordinary case, and anything deeper is a search away.
		if (query) params.set('search', query);

		let cancelled = false;
		setLoading(true);
		// A retry that is still running is not a failure. Leaving the old message up
		// makes every attempt after the first look like it failed instantly.
		setError(null);
		fetchClient
			.get<PickerItem[]>(`/api/projects/${projectSlug}/items?${params.toString()}`)
			.then((rows) => {
				if (cancelled) return;
				setItems(rows);
				setError(null);
			})
			.catch(() => {
				if (cancelled) return;
				setItems([]);
				setError('Could not load items.');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, [projectSlug, type, settledSearch]);

	return (
		<Dialog onClose={onClose} title={title} maxWidth="md">
			<div class={styles.search}>
				<Text
					type="search"
					value={search}
					placeholder="Search items..."
					// A placeholder is not a label: it is gone as soon as anything is
					// typed, and screen readers are not obliged to announce it.
					ariaLabel={title}
					onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
				/>
			</div>
			{error && <div class={styles.error} role="alert">{error}</div>}
			<div class={styles.list}>
				{clearOption && (
					<button type="button" class={styles.row} onClick={clearOption.onSelect}>
						<span class={styles.clear}>{clearOption.label}</span>
					</button>
				)}
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						class={styles.row}
						onClick={() => onSelect(item.key)}
					>
						<span class={styles.key}>{item.key}</span>
						<span class={styles.title}>{item.title}</span>
						<span class={styles.status}>{STATUS_LABELS[item.status] ?? item.status}</span>
					</button>
				))}
				{items.length === 0 && !loading && !error && <p class={styles.empty}>No matching items</p>}
			</div>
		</Dialog>
	);
}
