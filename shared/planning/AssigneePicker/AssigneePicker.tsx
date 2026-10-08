import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { fetchClient } from '@specboard/fetch';
import type { Person, ProjectRole } from '@specboard/models';
import { Avatar, Dialog } from '@specboard/ui';
import styles from './AssigneePicker.module.css';

/** The fields the picker renders off a row of GET /api/projects/:owner/:project/members. */
interface Assignable extends Person {
	role: ProjectRole;
}

const ROLE_LABELS: Record<ProjectRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

export interface AssigneePickerProps {
	projectRef: string;
	/** The current assignee's slug, marked in the list; null when nobody is assigned. */
	current: string | null;
	/** Called with the chosen person's user slug. */
	onSelect: (slug: string) => void;
	/** Unassign. Offered only when someone is assigned, so the picker never offers a no-op. */
	onUnassign?: () => void;
	onClose: () => void;
}

/** Modal list of the project's owner and members, for choosing who an item is assigned to. */
export function AssigneePicker({ projectRef, current, onSelect, onUnassign, onClose }: AssigneePickerProps): JSX.Element {
	const [people, setPeople] = useState<Assignable[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchClient
			// Push access is the settings page's concern, and costs the owner a GitHub check per member.
			.get<Assignable[]>(`/api/projects/${projectRef}/members?pushAccess=false`)
			.then((rows) => {
				if (!cancelled) setPeople(rows);
			})
			.catch(() => {
				if (!cancelled) setError('Could not load the members.');
			});
		return () => { cancelled = true; };
	}, [projectRef]);

	return (
		<Dialog onClose={onClose} title="Assign to" maxWidth="sm">
			{error && <div class={styles.error} role="alert">{error}</div>}
			<div class={styles.list}>
				{onUnassign && (
					<button type="button" class={styles.row} onClick={onUnassign}>
						<span class={styles.clear}>Unassign</span>
					</button>
				)}
				{people?.map((person) => {
					// Only an account that hasn't onboarded lacks a slug, and no member is one.
					const slug = person.slug;
					if (!slug) return null;
					return (
						<button
							key={slug}
							type="button"
							class={styles.row}
							aria-current={slug === current || undefined}
							onClick={() => onSelect(slug)}
						>
							<Avatar name={person.name} avatarUrl={person.avatarUrl} size="sm" tone="muted" decorative />
							<span class={styles.name}>{person.name}</span>
							<span class={styles.role}>{ROLE_LABELS[person.role]}</span>
						</button>
					);
				})}
				{!people && !error && <p class={styles.empty}>Loading...</p>}
			</div>
		</Dialog>
	);
}
