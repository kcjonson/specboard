/**
 * Waitlist signup handler tests
 *
 * Focus is the confirmation email: it fires exactly once for a genuinely new
 * signup, never for a duplicate, and never takes the request down with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
}));

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(async () => undefined),
	getWaitlistConfirmationEmailContent: vi.fn(() => ({
		subject: 'Thanks for joining the Specboard waitlist',
		textBody: 'text',
		htmlBody: '<p>html</p>',
	})),
}));

import { query } from '@specboard/db';
import { sendEmail } from '@specboard/email';
import { handleWaitlistSignup } from './waitlist.ts';

function mockQueryResult(rows: pg.QueryResultRow[] = [], rowCount = rows.length): pg.QueryResult {
	return { rows, rowCount, command: 'INSERT', oid: 0, fields: [] };
}

function createApp(): Hono {
	const app = new Hono();
	app.post('/api/waitlist', handleWaitlistSignup);
	return app;
}

function post(app: Hono, body: unknown): Promise<Response> {
	return Promise.resolve(
		app.request('http://localhost/api/waitlist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

describe('handleWaitlistSignup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(sendEmail).mockResolvedValue(undefined);
	});

	it('sends one confirmation email to the normalized address for a new signup', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([{ id: 'signup-uuid' }]) as never);

		const res = await post(createApp(), { email: 'Alice@Example.COM', company: 'Acme' });

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true });
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'alice@example.com',
				subject: 'Thanks for joining the Specboard waitlist',
			})
		);
	});

	it('sends nothing when the address is already on the list', async () => {
		// ON CONFLICT DO NOTHING ... RETURNING id yields no rows on a duplicate
		vi.mocked(query).mockResolvedValue(mockQueryResult([], 0) as never);

		const res = await post(createApp(), { email: 'alice@example.com' });

		// Still 201, so the response can't be used to probe who is on the list
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('still succeeds when the email fails to send', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([{ id: 'signup-uuid' }]) as never);
		vi.mocked(sendEmail).mockRejectedValue(new Error('SES is down'));

		const res = await post(createApp(), { email: 'alice@example.com' });

		// The row is already committed; a mail failure must not fail the request
		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
	});

	it('rejects an invalid address without touching the database or sending mail', async () => {
		const res = await post(createApp(), { email: 'not-an-email' });

		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
	});
});
