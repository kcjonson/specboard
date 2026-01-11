// Email client
export { sendEmail, type SendEmailOptions } from './client.ts';

// Email templates
export {
	getVerificationEmailContent,
	getPasswordResetEmailContent,
	type EmailContent,
} from './templates.ts';
