import { describe, it, expect } from 'vitest';
import { loadAgentSessionSecret } from './agent-session-secret.ts';

describe('loadAgentSessionSecret', () => {
	it('returns the configured secret', () => {
		const secret = 'a'.repeat(64);
		expect(loadAgentSessionSecret({ AGENT_SESSION_KEY_SECRET: secret })).toBe(secret);
	});

	it.each([
		['missing', {}],
		['empty', { AGENT_SESSION_KEY_SECRET: '' }],
		['too short to be a key', { AGENT_SESSION_KEY_SECRET: 'changeme' }],
	])('refuses to start when it is %s, with no default to fall back on', (_case, env) => {
		expect(() => loadAgentSessionSecret(env)).toThrow('AGENT_SESSION_KEY_SECRET');
	});
});
