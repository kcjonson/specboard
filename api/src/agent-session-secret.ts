/**
 * The server secret that keys agent session keys on the Map read (agentSessionKey in
 * @specboard/db). Read once at startup; there is no default, so a deploy without it
 * fails at boot instead of serving keys anyone could recompute.
 */

const MIN_LENGTH = 32;

export function loadAgentSessionSecret(env: Record<string, string | undefined> = process.env): string {
	const secret = env.AGENT_SESSION_KEY_SECRET;
	if (!secret || secret.length < MIN_LENGTH) {
		throw new Error(`AGENT_SESSION_KEY_SECRET must be set to at least ${MIN_LENGTH} characters`);
	}
	return secret;
}
