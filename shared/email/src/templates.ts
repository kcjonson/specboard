/**
 * Email templates for authentication flows
 *
 * Branding follows docs/brand.md. Email clients strip external CSS, SVG,
 * and webfonts, so the header lockup is a unicode chevron plus text and
 * everything is inline-styled.
 */

export interface EmailContent {
	subject: string;
	textBody: string;
	htmlBody: string;
}

const BRAND_PRIMARY = '#3b82f6';

function emailShell(inner: string): string {
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="margin: 0 0 32px;">
    <span style="color: ${BRAND_PRIMARY}; font-size: 20px;">&#9656;</span>
    <span style="font-size: 18px; font-weight: 700; color: #111; letter-spacing: -0.01em;">specboard</span>
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
	return `  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="color: #999; font-size: 12px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${url}" style="color: #666;">${url}</a>
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

	const htmlBody = emailShell(`  <h1 style="color: #111; font-size: 24px; margin-bottom: 24px;">Welcome to Specboard!</h1>

  <p>Please verify your email address by clicking the button below:</p>

${emailButton(verifyUrl, 'Verify Email Address')}

  <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p style="color: #666; font-size: 14px;">If you didn't create an account with Specboard, you can safely ignore this email.</p>

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

	const htmlBody = emailShell(`  <h1 style="color: #111; font-size: 24px; margin-bottom: 24px;">Sign in to Specboard</h1>

  <p>Click the button below to sign in:</p>

${emailButton(loginUrl, 'Sign In')}

  <p>Or enter this code on the sign-in page:</p>

  <p style="margin: 24px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; letter-spacing: 4px; font-weight: 600; color: #111;">${formattedCode}</p>

  <p style="color: #666; font-size: 14px;">The link and code expire in 15 minutes and can only be used once.</p>

  <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>

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

	const htmlBody = emailShell(`  <h1 style="color: #111; font-size: 24px; margin-bottom: 24px;">Password Reset Request</h1>

  <p>You requested to reset your password for your Specboard account.</p>

  <p>Click the button below to set a new password:</p>

${emailButton(resetUrl, 'Reset Password')}

  <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>

${emailLinkFallback(resetUrl)}`);

	return { subject, textBody, htmlBody };
}
