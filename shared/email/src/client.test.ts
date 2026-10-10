/**
 * What sendEmail writes to the logs when it doesn't send. The client reads its
 * environment at import, so each case stubs the environment and imports it fresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class { send = vi.fn(); },
	SendEmailCommand: class {},
}));

const TOKEN = 'c727da249e7060001f26e0d32e5bbf755840df058005fe5dba06946dda455576';
const message = {
	to: 'someone@gmail.com',
	subject: 'Kevin invited you to Specboard',
	textBody: `Open the invite: https://staging.specboard.io/invite?token=${TOKEN}`,
};

let logged: string;

beforeEach(() => {
	vi.resetModules();
	logged = '';
	vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged += `${args.join(' ')}\n`;
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

async function loadClient(env: Record<string, string>): Promise<typeof import('./client.ts')> {
	for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
	return import('./client.ts');
}

describe('sendEmail logging', () => {
	it('prints the body for a staging allowlist miss, where a tester needs the link', async () => {
		const { sendEmail } = await loadClient({ NODE_ENV: 'production', APP_ENV: 'staging', EMAIL_ALLOWLIST: 'specboard.io', EMAIL_MODE: '' });

		expect(await sendEmail(message)).toBe(false);
		expect(logged).toContain('BLOCKED');
		expect(logged).toContain(TOKEN);
	});

	it('keeps the body out of the log for an allowlist miss in any other environment', async () => {
		const { sendEmail } = await loadClient({ NODE_ENV: 'production', APP_ENV: 'development', EMAIL_ALLOWLIST: 'specboard.io', EMAIL_MODE: '' });

		expect(await sendEmail(message)).toBe(false);
		expect(logged).toContain('BLOCKED');
		expect(logged).toContain(message.subject);
		expect(logged).not.toContain(TOKEN);
	});
	it('prints the body in local console mode, where a developer needs the link', async () => {
		const { sendEmail } = await loadClient({ NODE_ENV: 'development', APP_ENV: 'development', EMAIL_ALLOWLIST: '', EMAIL_MODE: '' });

		expect(await sendEmail(message)).toBe(false);
		expect(logged).toContain('CONSOLE MODE');
		expect(logged).toContain(TOKEN);
	});
});
