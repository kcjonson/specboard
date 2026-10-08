import type { JSX } from 'preact';
import type { Person } from '@specboard/models';
import { Avatar } from '@specboard/ui';
import styles from './Table.module.css';

/** The Assignee column's content, for an item row or a child row: avatar and name, or a dash. */
export function AssigneeLabel({ person }: { person: Person | null | undefined }): JSX.Element {
	if (!person) return <>—</>;
	return (
		<span class={styles.assignee}>
			<Avatar name={person.name} avatarUrl={person.avatarUrl} size="xs" tone="muted" decorative />
			<span class={styles.assigneeName}>{person.name}</span>
		</span>
	);
}
