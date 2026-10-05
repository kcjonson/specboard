import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { StatusGlyph } from '@specboard/ui';
import type { RosterGroup } from './roster';
import styles from './AgentRoster.module.css';

export interface AgentRosterProps {
	groups: readonly RosterGroup[];
	/** A row was picked: select the item and fly there. */
	onPick(key: string): void;
	onClose(): void;
}

/**
 * Every computer with a session still in the cluster, and under it each session with the
 * items it is on: live sessions first, then quiet ones. Picking a row selects the item and
 * flies the Map there. Escape or a press outside closes it.
 */
export function AgentRoster({ groups, onPick, onClose }: AgentRosterProps): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const close = useRef(onClose);
	close.current = onClose;

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			// The Map's own Escape closes the drawer and clears the selection; the roster is closer, so it goes first.
			event.stopPropagation();
			close.current();
		};
		const onPointer = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			// The button that opens it toggles it, so a press on that is the button's to handle.
			if (target && !ref.current?.contains(target) && !(target as Element).closest?.('[aria-haspopup="dialog"]')) close.current();
		};
		document.addEventListener('keydown', onKey, true);
		document.addEventListener('pointerdown', onPointer);
		return () => {
			document.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onPointer);
		};
	}, []);

	useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);

	return (
		<div class={styles.roster} ref={ref} role="dialog" aria-label="Agents at work">
			{groups.length === 0 && <p class={styles.empty}>No agents at work. A session shows here while it has written in the last hour.</p>}
			{groups.map((group) => (
				<section key={group.device} class={styles.group} aria-label={group.label}>
					<h3 class={styles.computer}>
						<span>{group.label}</span>
						<span class={styles.tally}>{group.live === 0 ? 'none live' : `${group.live} live`} of {group.sessions.length}</span>
					</h3>
					{group.sessions.map((session) => (
						<div key={session.key} class={styles.session} data-state={session.state}>
							<p class={styles.sessionHead}>
								<span class={styles.number} aria-hidden="true">{session.number}</span>
								<span>{`Session ${session.number}, ${session.client}`}</span>
								<span class={styles.when}>{session.state === 'quiet' ? `quiet, ${session.lastWrite}` : session.lastWrite}</span>
							</p>
							{session.items.map((item) => (
								<button key={item.key} type="button" class={styles.row} onClick={() => onPick(item.key)}>
									<StatusGlyph class={styles.glyph} status={item.row.status} blocked={item.row.blocked} decorative />
									<span class={styles.itemKey}>{item.key}</span>
									<span class={styles.title}>{item.title}</span>
								</button>
							))}
						</div>
					))}
				</section>
			))}
		</div>
	);
}
