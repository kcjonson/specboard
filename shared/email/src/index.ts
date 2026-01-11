// Email client
// Note: .ts extensions are intentional - Node 25 runs TypeScript natively
export { sendEmail, type SendEmailOptions } from './client.ts';

// Email templates
export {
	getVerificationEmailContent,
	getPasswordResetEmailContent,
	type EmailContent,
} from './templates.ts';
