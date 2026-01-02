// Email client
export { sendEmail, type SendEmailOptions } from './client.js';

// Email templates
export {
	getVerificationEmailContent,
	getPasswordResetEmailContent,
	type EmailContent,
} from './templates.js';
