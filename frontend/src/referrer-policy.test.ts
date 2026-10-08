import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { noReferrerOnTokenPages, NO_REFERRER_PATHS } from './referrer-policy.ts';

function app(): Hono {
	const built = new Hono();
	built.use('*', noReferrerOnTokenPages());
	built.get('*', (context) => context.html('<p>page</p>'));
	return built;
}

describe('Referrer-Policy on token pages', () => {
	it.each([...NO_REFERRER_PATHS])('sends no-referrer on %s', async (path) => {
		const response = await app().request(`http://localhost${path}?token=${'a'.repeat(64)}`);
		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
	});

	it('covers the invite, signup and onboarding pages and the emailed-token pages', () => {
		expect([...NO_REFERRER_PATHS].sort()).toEqual(
			['/invite', '/magic-link', '/onboarding', '/reset-password', '/signup', '/verify-email/confirm']
		);
	});

	it('leaves other pages to the browser default', async () => {
		const response = await app().request('http://localhost/projects');
		expect(response.headers.get('Referrer-Policy')).toBeNull();
	});
});
