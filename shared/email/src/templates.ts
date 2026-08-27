/**
 * Email templates for authentication and waitlist flows
 *
 * Branding follows docs/brand.md. Email clients strip external CSS, SVG, and
 * webfonts, so the header lockup is a hosted PNG with styled alt text as the
 * fallback for clients that block remote images, and everything is
 * inline-styled.
 *
 * Dark mode: inline styles carry the light theme, and the one <style> block
 * carries the dark overrides. Clients never invert images, so the wordmark's
 * baked-in ink needs a second PNG rather than a CSS rule. The dark logo is
 * inline display:none and only revealed by the media query, so a client that
 * strips <style> falls back to light-only instead of stacking both.
 */

export interface EmailContent {
	subject: string;
	textBody: string;
	htmlBody: string;
}

const BRAND_PRIMARY = '#3b82f6';
const CONTACT_EMAIL = 'kevin@specboard.io';

// Absolute origin: an email is read outside any app session, so every asset
// URL has to be fully qualified. Served by frontend/src/index.ts.
const APP_URL = process.env.APP_URL || 'https://specboard.io';
const LOGO_URL = `${APP_URL}/email-logo.png`;
const LOGO_DARK_URL = `${APP_URL}/email-logo-dark.png`;

function emailShell(inner: string): string {
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #1a1a1a !important; color: #d0d0d0 !important; }
      .sb-h1 { color: #f0f0f0 !important; }
      .sb-muted { color: #8a8a8a !important; }
      .sb-link { color: #60a5fa !important; }
      .sb-rule { border-top-color: #333333 !important; }
      .sb-logo-light { display: none !important; }
      .sb-logo-dark { display: block !important; }
    }
  </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="margin: 0 0 32px;">
    <img class="sb-logo-light" src="${LOGO_URL}" alt="specboard" width="246" height="40" style="display: block; border: 0; font-size: 24px; font-weight: 700; color: #111; letter-spacing: -0.01em;">
    <img class="sb-logo-dark" src="${LOGO_DARK_URL}" alt="specboard" width="246" height="40" style="display: none; border: 0; font-size: 24px; font-weight: 700; color: #f0f0f0; letter-spacing: -0.01em;">
  </p>

${inner}
</body>
</html>`;
}

function emailButton(url: string, label: string): string {
	return `  <p style="margin: 32px 0;">
    <a href="${url}" style="display: inline-block; background-color: ${BRAND_PRIMARY}; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">${label}</a>
  </p>`;
}

function emailLinkFallback(url: string): string {
	return `  <hr class="sb-rule" style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p class="sb-muted" style="color: #999; font-size: 12px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a class="sb-muted" href="${url}" style="color: #666;">${url}</a>
  </p>`;
}

/**
 * Email verification email content
 */
export function getVerificationEmailContent(verifyUrl: string): EmailContent {
	const subject = 'Verify your email address - Specboard';

	const textBody = `Welcome to Specboard!

Please verify your email address by clicking the link below:

${verifyUrl}

This link will expire in 1 hour.

If you didn't create an account with Specboard, you can safely ignore this email.

- The Specboard Team`;

	const htmlBody = emailShell(`  <h1 class="sb-h1" style="color: #111; font-size: 24px; margin-bottom: 24px;">Welcome to Specboard!</h1>

  <p>Please verify your email address by clicking the button below:</p>

${emailButton(verifyUrl, 'Verify Email Address')}

  <p class="sb-muted" style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p class="sb-muted" style="color: #666; font-size: 14px;">If you didn't create an account with Specboard, you can safely ignore this email.</p>

${emailLinkFallback(verifyUrl)}`);

	return { subject, textBody, htmlBody };
}

/**
 * Magic link sign-in email content
 * Carries both a login link and a typed code so it works when the email is
 * read on a different device than the login page.
 */
export function getMagicLinkEmailContent(loginUrl: string, formattedCode: string): EmailContent {
	const subject = 'Your sign-in code - Specboard';

	const textBody = `Sign in to Specboard

Click the link below to sign in:

${loginUrl}

Or enter this code on the sign-in page:

${formattedCode}

The link and code expire in 15 minutes and can only be used once.

If you didn't request this, you can safely ignore this email.

- The Specboard Team`;

	const htmlBody = emailShell(`  <h1 class="sb-h1" style="color: #111; font-size: 24px; margin-bottom: 24px;">Sign in to Specboard</h1>

  <p>Click the button below to sign in:</p>

${emailButton(loginUrl, 'Sign In')}

  <p>Or enter this code on the sign-in page:</p>

  <p class="sb-h1" style="margin: 24px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; letter-spacing: 4px; font-weight: 600; color: #111;">${formattedCode}</p>

  <p class="sb-muted" style="color: #666; font-size: 14px;">The link and code expire in 15 minutes and can only be used once.</p>

  <p class="sb-muted" style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>

${emailLinkFallback(loginUrl)}`);

	return { subject, textBody, htmlBody };
}

/**
 * Password reset email content
 */
export function getPasswordResetEmailContent(resetUrl: string): EmailContent {
	const subject = 'Reset your password - Specboard';

	const textBody = `Password Reset Request

You requested to reset your password for your Specboard account.

Click the link below to set a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

- The Specboard Team`;

	const htmlBody = emailShell(`  <h1 class="sb-h1" style="color: #111; font-size: 24px; margin-bottom: 24px;">Password Reset Request</h1>

  <p>You requested to reset your password for your Specboard account.</p>

  <p>Click the button below to set a new password:</p>

${emailButton(resetUrl, 'Reset Password')}

  <p class="sb-muted" style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p class="sb-muted" style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>

${emailLinkFallback(resetUrl)}`);

	return { subject, textBody, htmlBody };
}

/**
 * Waitlist signup confirmation
 *
 * Personal thank-you rather than a transactional notice: no button, no
 * expiring link, nothing to click through to. The reply address is the only
 * action offered.
 */
export function getWaitlistConfirmationEmailContent(): EmailContent {
	const subject = 'Thanks for joining the Specboard waitlist';

	const textBody = `Thanks for signing up for early access.

We're building Specboard to keep specs, planning, and the agents that read them in one place. You're on the list, and we'll email you when a spot opens up.

If you have questions, or you just want to tell us what you're hoping it does, write to ${CONTACT_EMAIL}.

- Kevin`;

	const htmlBody = emailShell(`  <h1 class="sb-h1" style="color: #111; font-size: 24px; margin-bottom: 24px;">Thanks for signing up for early access.</h1>

  <p>We're building Specboard to keep specs, planning, and the agents that read them in one place. You're on the list, and we'll email you when a spot opens up.</p>

  <p>If you have questions, or you just want to tell us what you're hoping it does, write to <a class="sb-link" href="mailto:${CONTACT_EMAIL}" style="color: ${BRAND_PRIMARY};">${CONTACT_EMAIL}</a>.</p>

  <p style="margin-top: 32px;">- Kevin</p>`);

	return { subject, textBody, htmlBody };
}
