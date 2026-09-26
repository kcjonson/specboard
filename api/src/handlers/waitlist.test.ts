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
}));

vi.mock('@specboard/email', () => ({
	sendEmail: vi.fn(async () => true),
	getWaitlistConfirmationEmailContent: vi.fn(() => ({
		subject: 'Thanks for joining the Specboard waitlist',
		textBody: 'text',
		htmlBody: '<p>html</p>',
		replyTo: 'kevin@specboard.io',
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

// Microsecond precision matters: the claim is the owner token and has to
// round-trip exactly.
const CLAIM = '2026-09-26 15:21:45.123456+00';

interface DbScenario {
	// false: ON CONFLICT DO NOTHING hit an existing row
	inserted?: boolean;
	// false: the row is already confirmed or another request holds a live claim
	claimed?: boolean;
	insertError?: Error;
	releaseError?: Error;
}

function mockDb({ inserted = true, claimed = true, insertError, releaseError }: DbScenario = {}): void {
	vi.mocked(query).mockImplementation((async (sql: string) => {
		if (sql.includes('INSERT')) {
			if (insertError) throw insertError;
			return mockQueryResult([], inserted ? 1 : 0);
		}
		if (sql.includes('RETURNING id')) return mockQueryResult(claimed ? [{ id: 'signup-uuid', claim: CLAIM }] : []);
		if (sql.includes('confirmation_claimed_at = NULL') && releaseError) throw releaseError;
		return mockQueryResult([], 1);
	}) as never);
}

// The send is fire-and-forget, so the response lands before it finishes. Every
// mock resolves immediately, so one macrotask turn drains the whole chain.
function settleSend(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function queryCalls(fragment: string): unknown[][] {
	return vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes(fragment));
}

function claimCalls(): unknown[][] {
	return queryCalls('confirmation_claimed_at = NOW()');
}

function stampCalls(): unknown[][] {
	return queryCalls('confirmation_sent_at = NOW()');
}

function releaseCalls(): unknown[][] {
	return queryCalls('confirmation_claimed_at = NULL');
}

describe('handleWaitlistSignup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(sendEmail).mockResolvedValue(true);
		mockDb();
	});

	it('claims, sends one confirmation email to the normalized address, then stamps it', async () => {
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
		expect(claimCalls()).toEqual([[expect.any(String), ['alice@example.com', '10 minutes']]]);
		expect(stampCalls()).toEqual([[expect.any(String), ['signup-uuid']]]);
		expect(releaseCalls()).toHaveLength(0);

		// SES accepted it, so the stamp lands even if our lease lapsed and
		// another request claimed the row meanwhile; only the first acceptance
		// keeps its timestamp.
		const [stampSql] = stampCalls()[0] as [string];
		expect(stampSql).not.toMatch(/confirmation_claimed_at/);
		expect(stampSql).toMatch(/confirmation_sent_at IS NULL/);

		// Claim and stamp are separate autocommit statements on either side of
		// the send, so no connection or row lock is held while SES is called.
		const [, claimOrder, stampOrder] = vi.mocked(query).mock.invocationCallOrder;
		const [sendOrder] = vi.mocked(sendEmail).mock.invocationCallOrder;
		expect(claimOrder).toBeLessThan(sendOrder!);
		expect(stampOrder).toBeGreaterThan(sendOrder!);
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
		mockDb({ inserted: false });

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com' }));
		expect(stampCalls()).toHaveLength(1);
	});

	it('sends nothing when the address is already confirmed', async () => {
		mockDb({ inserted: false, claimed: false });

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// Still 201, so the response can't be used to probe who is on the list
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(0);

		const [claimSql] = claimCalls()[0] as [string];
		expect(claimSql).toMatch(/confirmation_sent_at IS NULL/);
	});

	it('sends nothing when another request holds a live claim on the address', async () => {
		mockDb({ inserted: false, claimed: false });

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(sendEmail).not.toHaveBeenCalled();
		expect(stampCalls()).toHaveLength(0);
		expect(releaseCalls()).toHaveLength(0);

		// Only an unclaimed row, or one whose lease lapsed after a crash
		// mid-send, can be claimed; that is what keeps a concurrent submission
		// of the same address from sending a duplicate.
		const [claimSql, claimParams] = claimCalls()[0] as [string, unknown[]];
		expect(claimSql).toMatch(/confirmation_claimed_at IS NULL OR confirmation_claimed_at < NOW\(\) - \$2::interval/);
		expect(claimParams).toEqual(['alice@example.com', '10 minutes']);
	});

	it('still succeeds when the email fails to send, and releases the claim for an immediate retry', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const sesError = new Error('SES is down');
		vi.mocked(sendEmail).mockRejectedValue(sesError);

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// The row is already committed; a mail failure must not fail the request
		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(stampCalls()).toHaveLength(0);
		expect(releaseCalls()).toEqual([[expect.stringMatching(/confirmation_sent_at IS NULL/), ['signup-uuid', CLAIM]]]);
		expect(consoleError).toHaveBeenCalledWith(
			'Waitlist confirmation email failed for alice@example.com:',
			sesError
		);
		consoleError.mockRestore();
	});

	it('releases only its own claim, so a newer claim taken after its lease lapsed survives', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(sendEmail).mockRejectedValue(new Error('SES is down'));

		await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		// A stale owner clearing the row by id alone would let a third request
		// send alongside the newer owner still in flight.
		const [claimSql] = claimCalls()[0] as [string];
		expect(claimSql).toMatch(/RETURNING id, confirmation_claimed_at::text AS claim/);
		const [releaseSql, releaseParams] = releaseCalls()[0] as [string, unknown[]];
		expect(releaseSql).toMatch(/confirmation_claimed_at = \$2::timestamptz/);
		expect(releaseParams).toEqual(['signup-uuid', CLAIM]);
		consoleError.mockRestore();
	});

	it('releases the claim without stamping when the email was logged or blocked instead of sent', async () => {
		// Console mode, a staging allowlist block, or no SES client: nothing
		// went out, so the address must stay eligible for a real send later.
		vi.mocked(sendEmail).mockResolvedValue(false);

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(sendEmail).toHaveBeenCalledOnce();
		expect(stampCalls()).toHaveLength(0);
		expect(releaseCalls()).toEqual([[expect.stringMatching(/confirmation_claimed_at = \$2::timestamptz/), ['signup-uuid', CLAIM]]]);
	});

	it('still logs the SES error when releasing the claim also fails', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const sesError = new Error('SES is down');
		const releaseError = new Error('connection reset');
		vi.mocked(sendEmail).mockRejectedValue(sesError);
		mockDb({ releaseError });

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(201);
		expect(consoleError).toHaveBeenCalledWith(
			'Waitlist confirmation claim release failed for alice@example.com:',
			releaseError
		);
		expect(consoleError).toHaveBeenCalledWith(
			'Waitlist confirmation email failed for alice@example.com:',
			sesError
		);
		consoleError.mockRestore();
	});

	it('returns 500 and sends nothing when the signup cannot be saved', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mockDb({ insertError: new Error('connection refused') });

		const res = await post(createApp(), { email: 'alice@example.com' });
		await settleSend();

		expect(res.status).toBe(500);
		expect(claimCalls()).toHaveLength(0);
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
		expect(sendEmail).not.toHaveBeenCalled();
	});
});
