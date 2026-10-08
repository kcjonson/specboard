import type { Actor } from '@specboard/models';

/** What a deleted account's actor reads as. */
const DELETED_PERSON = 'Deleted user';

/**
 * Human label for the sanitized actor the API returns (origin, workers, activity log):
 * the person, and for an agent the client and device it acted from, "Kevin via
 * claude-code on laptop".
 */
export function actorLabel(actor: Actor): string {
	if (actor.type === 'system') return 'System';
	const who = actor.person?.name ?? DELETED_PERSON;
	if (actor.type === 'user') return who;
	const via = actor.client?.name || 'an agent';
	return actor.deviceName ? `${who} via ${via} on ${actor.deviceName}` : `${who} via ${via}`;
}
