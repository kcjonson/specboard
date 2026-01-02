/**
 * Email client using AWS SES
 *
 * Environment variables:
 * - NODE_ENV: 'development' logs emails to console instead of sending
 * - APP_ENV: Application environment ('production', 'staging', etc.)
 *            Used for email safety - staging uses allowlist, production sends all
 * - EMAIL_MODE: 'console' forces console logging regardless of NODE_ENV
 * - EMAIL_ALLOWLIST: Comma-separated list of allowed email domains for non-production
 *                    e.g., 'specboard.io,example.com' - only emails to these domains will be sent
 *                    If not set in non-production, all emails are blocked (logged only)
 * - SES_REGION: AWS region for SES (default: us-west-2)
 * - EMAIL_FROM: Sender email address (default: noreply@specboard.io)
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const SES_REGION = process.env.SES_REGION || 'us-west-2';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@specboard.io';
const NODE_ENV = process.env.NODE_ENV || 'development';
const APP_ENV = process.env.APP_ENV || 'development';
const EMAIL_MODE = process.env.EMAIL_MODE;
const EMAIL_ALLOWLIST = process.env.EMAIL_ALLOWLIST;

// Only create SES client if we might actually use it
// sendEmail bypasses SES when NODE_ENV is 'development' or EMAIL_MODE is 'console'
const sesClient = NODE_ENV !== 'development' && EMAIL_MODE !== 'console'
	? new SESClient({ region: SES_REGION })
	: null;

export interface SendEmailOptions {
	to: string;
	subject: string;
	textBody: string;
	htmlBody?: string;
}

/**
 * Check if an email address is allowed based on the allowlist
 */
function isEmailAllowed(email: string): boolean {
	if (!EMAIL_ALLOWLIST) {
		return false;
	}

	// Validate email format: must have exactly one '@', not at start/end
	const atIndex = email.indexOf('@');
	if (atIndex <= 0 || atIndex !== email.lastIndexOf('@') || atIndex === email.length - 1) {
		return false;
	}

	const allowedDomains = EMAIL_ALLOWLIST.split(',').map(d => d.trim().toLowerCase());
	const emailDomain = email.slice(atIndex + 1).toLowerCase();

	return allowedDomains.includes(emailDomain);
}

/**
 * Log email to console (for development/testing)
 */
function logEmail(options: SendEmailOptions, reason: string): void {
	console.log('\n========================================');
	console.log(`EMAIL ${reason}`);
	console.log('========================================');
	console.log(`To: ${options.to}`);
	console.log(`From: ${EMAIL_FROM}`);
	console.log(`Subject: ${options.subject}`);
	console.log('----------------------------------------');
	console.log('Text Body:');
	console.log(options.textBody);
	if (options.htmlBody) {
		console.log('----------------------------------------');
		console.log('HTML Body: [omitted - see text body above]');
	}
	console.log('========================================\n');
}

/**
 * Send an email via AWS SES
 *
 * In development mode (NODE_ENV=development or EMAIL_MODE=console),
 * emails are logged to console instead of being sent.
 *
 * In non-production app environments (APP_ENV !== 'production') with EMAIL_ALLOWLIST set,
 * only emails to allowed domains will be sent.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
	const { to, subject, textBody, htmlBody } = options;

	// Development mode: always log to console
	if (NODE_ENV === 'development' || EMAIL_MODE === 'console') {
		logEmail(options, '(CONSOLE MODE - not sent)');
		return;
	}

	// Non-production app environment: check allowlist
	if (APP_ENV !== 'production') {
		if (!isEmailAllowed(to)) {
			logEmail(options, `(BLOCKED - ${to} not in allowlist: ${EMAIL_ALLOWLIST || 'none'})`);
			return;
		}
		console.log(`[Email] Sending to ${to} (allowed by EMAIL_ALLOWLIST)`);
	}

	if (!sesClient) {
		console.error('[Email] SES client not initialized but trying to send email');
		logEmail(options, '(ERROR - SES client not initialized)');
		return;
	}

	const command = new SendEmailCommand({
		Source: EMAIL_FROM,
		Destination: {
			ToAddresses: [to],
		},
		Message: {
			Subject: {
				Data: subject,
				Charset: 'UTF-8',
			},
			Body: {
				Text: {
					Data: textBody,
					Charset: 'UTF-8',
				},
				...(htmlBody && {
					Html: {
						Data: htmlBody,
						Charset: 'UTF-8',
					},
				}),
			},
		},
	});

	await sesClient.send(command);
}
