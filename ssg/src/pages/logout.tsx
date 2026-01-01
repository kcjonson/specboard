/**
 * Logout page - invisible redirect that logs the user out
 * Calls the logout API and immediately redirects to /login
 */
import type { JSX } from 'preact';

export function LogoutContent(): JSX.Element {
	// Empty body - the script handles everything
	return <div />;
}

export const logoutScript = `(function() {
	fetch('/api/auth/logout', {
		method: 'POST',
		credentials: 'same-origin'
	})
	.finally(function() {
		window.location.href = '/login';
	});
})();`;
