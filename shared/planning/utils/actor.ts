import type { Actor } from '@specboard/models';

/** Human label for the sanitized actor the API returns (origin, workers, activity log). */
export function actorLabel(actor: Actor): string {
	if (actor.type === 'agent') {
		const name = actor.client?.name || 'Agent';
		return actor.deviceName ? `${name} on ${actor.deviceName}` : name;
	}
	if (actor.type === 'system') return 'System';
	return 'User';
}
