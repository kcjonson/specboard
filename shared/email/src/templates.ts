/**
 * Email templates for authentication flows
 */

export interface EmailContent {
	subject: string;
	textBody: string;
	htmlBody: string;
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

	const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #111; font-size: 24px; margin-bottom: 24px;">Welcome to Specboard!</h1>

  <p>Please verify your email address by clicking the button below:</p>

  <p style="margin: 32px 0;">
    <a href="${verifyUrl}" style="display: inline-block; background-color: #111; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Verify Email Address</a>
  </p>

  <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p style="color: #666; font-size: 14px;">If you didn't create an account with Specboard, you can safely ignore this email.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="color: #999; font-size: 12px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${verifyUrl}" style="color: #666;">${verifyUrl}</a>
  </p>
</body>
</html>`;

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

	const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #111; font-size: 24px; margin-bottom: 24px;">Password Reset Request</h1>

  <p>You requested to reset your password for your Specboard account.</p>

  <p>Click the button below to set a new password:</p>

  <p style="margin: 32px 0;">
    <a href="${resetUrl}" style="display: inline-block; background-color: #111; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Reset Password</a>
  </p>

  <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>

  <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

  <p style="color: #999; font-size: 12px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${resetUrl}" style="color: #666;">${resetUrl}</a>
  </p>
</body>
</html>`;

	return { subject, textBody, htmlBody };
}
