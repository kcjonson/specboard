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

Send path: handler → `@specboard/email` `sendEmail()` → SES. Templates in `shared/email/src/templates.ts`. Only three emails exist: signup verification, verification resend, password reset. All user-triggered.

## Sandbox status

The account is in the SES sandbox (sends only to verified domains). The January 2026 production access request was denied (case 176774600400459); see `.claude/plans/email-failure-analysis.md` for the post-mortem and `.claude/plans/email-recovery.md` for the recovery plan and resubmission checklist. Sandbox end-to-end testing (verification + reset flows through staging) passed 2026-08-15.

## Testing in staging

Sign up at staging.specboard.io with a `@specboard.io` address (StartMail alias must exist; catch-all is off) and an invite key from the `specboard/staging/invite-keys` secret. The verification email should arrive in StartMail within seconds. Check `/ecs/staging/api` logs, filter `Email`, if it doesn't.

## DMARC reports

Mailbox providers periodically send aggregate XML reports to dmarc-reports@ describing mail claiming to be from specboard.io and whether it passed authentication. They're informational; after a few clean weeks the DMARC policy can be tightened from `p=quarantine` to `p=reject`.
