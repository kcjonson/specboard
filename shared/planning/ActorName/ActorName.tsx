import type { JSX } from 'preact';
import type { Actor } from '@specboard/models';
import { Avatar } from '@specboard/ui';
import { actorLabel } from '../utils/actor';
import styles from './ActorName.module.css';

export interface ActorNameProps {
	actor: Actor;
	class?: string;
}

/** An actor's label, after the person's avatar when there is a person to show. */
export function ActorName({ actor, class: className }: ActorNameProps): JSX.Element {
	const person = actor.type === 'system' ? null : actor.person;
	return (
		<span class={[styles.actor, className].filter(Boolean).join(' ')}>
			{person && <Avatar name={person.name} avatarUrl={person.avatarUrl} size="xs" tone="muted" decorative />}
			{actorLabel(actor)}
		</span>
	);
}
