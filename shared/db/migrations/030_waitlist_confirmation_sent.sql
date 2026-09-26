-- confirmation_sent_at: when the waitlist confirmation email was accepted by
-- SES, NULL until then.
--
-- confirmation_claimed_at: a lease on the send. The API claims an unsent row
-- with a single UPDATE, calls SES with no connection or row lock held, then
-- stamps confirmation_sent_at. A failed send clears the claim so the next
-- submission retries at once; a task that dies mid-send leaves it set, and it
-- lapses after the lease window (10 minutes, set in the API) so a later
-- submission can retry. A live claim is what stops two concurrent submissions
-- of one address from both sending.
--
-- The send used to be gated on the INSERT creating a row, so a failed send
-- (SES throttle or 5xx, the task replaced mid-send) could never be retried:
-- resubmitting hit the conflict and skipped it. The API now sends whenever
-- confirmation_sent_at is NULL and stamps it after SES accepts the message, so
-- resubmitting is the retry, and "who never got a confirmation" is
-- WHERE confirmation_sent_at IS NULL.
--
-- No backfill: existing rows stay NULL because nothing on record says they
-- were sent. The waitlist predates the confirmation email by seven months, so
-- rows from before it shipped never had one, and for the rest a send was
-- fire-and-forget with only a log line on failure. NULL triggers nothing by itself; the API
-- only sends when that address is submitted again, which is the person asking
-- for it. Rows known from SES or the logs to have been sent can be stamped
-- by hand; stamping them all here on a guess would hide exactly the rows the
-- NULL query exists to find.
--
-- Rolling-deploy safe: nullable, no default, so each ADD COLUMN is
-- catalog-only. The previous release never writes them and its SELECT *
-- mapping ignores them.

ALTER TABLE waitlist_signups
	ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
	ADD COLUMN confirmation_claimed_at TIMESTAMPTZ;
