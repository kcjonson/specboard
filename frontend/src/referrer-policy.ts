/**
 * Referrer-Policy for pages whose URL carries a secret or an invitation: the emailed
 * tokens (/magic-link, /reset-password, /verify-email/confirm, /invite, /signup?invite=)
 * and the invitation an onboarding `next` points back to. Anything the page loads or
 * links to would otherwise be sent that URL in the Referer header.
 */

import type { MiddlewareHandler } from 'hono';

export const NO_REFERRER_PATHS: ReadonlySet<string> = new Set([
	'/invite',
	'/signup',
	'/onboarding',
	'/magic-link',
	'/reset-password',
	'/verify-email/confirm',
]);

export function noReferrerOnTokenPages(): MiddlewareHandler {
	return async (context, next) => {
		await next();
		if (NO_REFERRER_PATHS.has(context.req.path)) {
			context.header('Referrer-Policy', 'no-referrer');
		}
	};
}
