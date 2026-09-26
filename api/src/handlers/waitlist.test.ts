/**
 * Waitlist signup handler tests
 *
 * Focus is the confirmation email: it fires until one is sent for an address
 * (so resubmitting retries a failed send), never again after that, and never
 * takes the request down with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type pg from 'pg';

vi.mock('@specboard/db', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(async () => undefined),
	getWaitlistConfirmationEmailContent: vi.fn(() => ({
		subject: 'Thanks for joining the Specboard waitlist',
		textBody: 'text',
		htmlBody: '<p>html</p>',
		replyTo: 'kevin@specboard.io',
	})),
}));

import { query, transaction } from '@specboard/db';
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

// The claim SELECT runs on the transaction client; an empty result means the
// row is already confirmed or another request holds it mid-send.
const txClient = { query: vi.fn() };
let pendingSend: Promise<unknown> | undefined;

function claimReturns(rows: pg.QueryResultRow[]): void {
	txClient.query.mockImplementation(async (sql: string) =>
		sql.includes('SELECT') ? mockQueryResult(rows) : mockQueryResult([], 1)
	);
}

// The send is fire-and-forget, so the response lands before it finishes.
async function settleSend(): Promise<void> {
	await pendingSend?.catch(() => undefined);
}

function stampCalls(): unknown[][] {
	return txClient.query.mock.calls.filter(([sql]) => String(sql).includes('confirmation_sent_at = NOW()'));
}

describe('handleWaitlistSignup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pendingSend = undefined;
		vi.mocked(sendEmail).mockResolvedValue(undefined);
		vi.mocked(query).mockResolvedValue(mockQueryResult([], 1) as never);
		vi.mocked(transaction).mockImplementation(((fn: (client: typeof txClient) => Promise<unknown>) => {
			pendingSend = fn(txClient);
			return pendingSend;
		}) as never);
		claimReturns([{ id: 'signup-uuid' }]);
	});

	it('sends one confirmation email to the normalized address for a new signup, then stamps it', async () => {
		const res = await post(createApp(), { email: 'Alice@Example.COM', company: 'Acme' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true });
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'alice@example.com',
				subject: 'Thanks for joining the Specboard waitlist',
			})
		);
		expect(stampCalls()).toEqual([[expect.any(String), ['signup-uuid']]]);
	});

	it('routes replies to the address the copy tells people to write to', async () => {
		await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// Most recipients hit Reply rather than clicking the mailto link, so
		// this has to be set or replies land on the noreply Source address.
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ replyTo: 'kevin@specboard.io' })
		);
	});

	it('retries the send when an address already on the list was never confirmed', async () => {
		// ON CONFLICT DO NOTHING: the row exists, but confirmation_sent_at is NULL
		vi.mocked(query).mockResolvedValue(mockQueryResult([], 0) as never);

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com' }));
		expect(stampCalls()).toHaveLength(1);
	});

	it('sends nothing when the address is already confirmed or mid-send elsewhere', async () => {
		vi.mocked(query).mockResolvedValue(mockQueryResult([], 0) as never);
		claimReturns([]);

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// Still 201, so the response can't be used to probe who is on the list
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(0);

		// Only unsent rows are claimable, and SKIP LOCKED is what keeps a
		// concurrent submission of the same address from sending a duplicate.
		const [claimSql, claimParams] = txClient.query.mock.calls[0] as [string, unknown[]];
		expect(claimSql).toMatch(/confirmation_sent_at IS NULL/);
		expect(claimSql).toMatch(/FOR UPDATE SKIP LOCKED/);
		expect(claimParams).toEqual(['alice@example.com']);
	});

	it('still succeeds when the email fails to send, and leaves it unstamped for a retry', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const sesError = new Error('SES is down');
		vi.mocked(sendEmail).mockRejectedValue(sesError);

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// The row is already committed; a mail failure must not fail the request
		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(stampCalls()).toHaveLength(0);
		// transaction() rejects, which rolls back and releases the row lock
		await expect(pendingSend).rejects.toBe(sesError);
		await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
			'Waitlist confirmation email failed for alice@example.com:',
			sesError
		));
		consoleError.mockRestore();
	});

	it('returns 500 and sends nothing when the signup cannot be saved', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(query).mockRejectedValue(new Error('connection refused'));

		const res = await post(createApp(), { email: 'alice@example.com' });

		expect(res.status).toBe(500);
		expect(transaction).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('accepts a pasted address with surrounding whitespace', async () => {
		// isValidEmail rejects surrounding whitespace, so validating the raw
		// value would 400 this before the trim ever ran.
		const res = await post(createApp(), { email: '  Alice@Example.COM  ' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'alice@example.com' })
		);
	});

	it('rejects an invalid address without touching the database or sending mail', async () => {
		const res = await post(createApp(), { email: 'not-an-email' });

		expect(res.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
		expect(transaction).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
	});
});
