# Email (SES + StartMail)

**Region:** us-west-2
**Senders:** noreply@specboard.io (production), noreply@staging.specboard.io (staging)
**Human mail:** kevin@, admin@, dmarc-reports@ via StartMail

## The one rule

**Everything email-related is defined in CDK. Never hand-edit the Route53 zone or SES config.** In February 2026 a CDK zone recreation silently destroyed hand-added DNS records (SES DKIM, all StartMail records), which broke sending and inbound mail for months. Hand-added records will be lost again the next time the zone churns; CDK-defined records come back automatically.

Everything lives in the shared (staging) stack in `infra/lib/specboard-stack.ts`:

- Two SES identities, `specboard.io` and `staging.specboard.io`, each with Easy DKIM records wired from the identity's token attributes. Staging has its own identity so its DKIM reputation is isolated from production.
- StartMail MX and DKIM records, merged SPF (`include:spf.startmail.com include:amazonses.com`), and DMARC (`p=quarantine`, reports to dmarc-reports@).
- Configuration set `specboard-email`, the default for both identities. Bounce/complaint/reject events publish to the `email-events` SNS topic (subscribed: admin@). CloudWatch alarms fire at 5% bounce / 0.1% complaint rates.

Gotchas encoded in the stack, do not "simplify" them away:

- DKIM records use `CfnRecordSet`, not `CnameRecord`: the token name attribute is already a FQDN and `CnameRecord` appends the zone name to unresolved tokens (upstream CDK bug; their own SES module works around it the same way).
- The task role needs `ses:SendEmail` on the configuration-set ARN, not just the identities. Without it every send fails with AccessDenied because the identities carry a default configuration set.

## Environment behavior

| Environment | From | Recipients |
|-------------|------|------------|
| Development | console log only | n/a |
| Staging | noreply@staging.specboard.io | `EMAIL_ALLOWLIST=specboard.io` hard-blocks everything else |
| Production | noreply@specboard.io | unrestricted (empty allowlist) |

Send path: handler → `@specboard/email` `sendEmail()` → SES. Templates in `shared/email/src/templates.ts`. Only four emails exist: signup verification, verification resend, password reset, and the waitlist confirmation. All user-triggered.

The waitlist confirmation is sent until one succeeds per address: `waitlist_signups.confirmation_sent_at` is stamped when SES accepts it, a failed send leaves it NULL so submitting the form again retries, and `SELECT email FROM waitlist_signups WHERE confirmation_sent_at IS NULL` lists who never got one. Rows from before that column existed (migration 030) are NULL too, since nothing recorded whether they were sent.

A lease column guards the send. The handler claims the row with one `UPDATE` that sets `confirmation_claimed_at` (only if unsent and unclaimed, or the claim is older than 10 minutes), calls SES with no database connection held, then stamps `confirmation_sent_at`. A concurrent submission of the same address finds the live claim and sends nothing. A failed send clears the claim so the next submission retries immediately, and so does a send that `sendEmail` logged or blocked instead of submitting (console mode, a staging allowlist miss): it resolves `false`, and the row is left unstamped so the address still gets a real send later; a task that dies mid-send leaves the claim in place, and that address can't be retried until it lapses 10 minutes later. The claimed timestamp is the owner token: the claim returns it as text (a JS `Date` would drop the microseconds) and the release only clears a claim still holding that value, so a sender whose lease lapsed can't wipe a newer claim and let a third request send. The stamp is not tied to the token, since SES accepting the message means it went out regardless of whose lease is current, and it keeps the first acceptance's timestamp. The lease only stays exclusive because a send can't outlive it: the SES client sets a 30s `requestTimeout` with `throwOnRequestTimeout` (`shared/email/src/client.ts`), so with the SDK's three attempts a hung send fails after about 90 seconds instead of hanging indefinitely. Holding a transaction across the SES call instead would pin a pool connection per in-flight send, and a throttled SES could then starve unrelated API requests.

## Sandbox status

The January 2026 production access request was denied (case 176774600400459): the bounce and
complaint handling question went unanswered and the use case was framed as staging-only. A second
root cause surfaced later, the February 24 CDK zone recreation silently wiped the DKIM and StartMail
DNS records. Sandbox end-to-end testing (verification and reset flows through staging) passed
2026-08-15, and the config-set IAM gap found during that recovery was fixed in PR #153.

Confirm current sandbox-or-production standing in the SES console before relying on this section;
it is not asserted here because it changes outside the repo.

## Testing in staging

Sign up at staging.specboard.io with a `@specboard.io` address (StartMail alias must exist; catch-all is off) and an invite key from the `specboard/staging/invite-keys` secret. The verification email should arrive in StartMail within seconds. Check `/ecs/staging/api` logs, filter `Email`, if it doesn't.

## DMARC reports

Mailbox providers periodically send aggregate XML reports to dmarc-reports@ describing mail claiming to be from specboard.io and whether it passed authentication. They're informational; after a few clean weeks the DMARC policy can be tightened from `p=quarantine` to `p=reject`.
