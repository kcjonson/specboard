/**
 * Verify email confirmation page - processes the token from email link
 */
import type { JSX } from 'preact';

export function VerifyEmailConfirmContent(): JSX.Element {
	return (
		<div class="auth-container">
			<h1>Verifying Email...</h1>

			<div id="loading" class="loading-state">
				<p>Please wait while we verify your email address.</p>
			</div>

			<div id="success" class="result-state hidden">
				<div class="success-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</div>
				<p>Your email has been verified!</p>
				<p class="redirect-note">Redirecting to sign in...</p>
				<a href="/login" class="btn">Go to Sign In</a>
			</div>

			<div id="error" class="result-state hidden">
				<div class="error-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</div>
				<p id="error-message">Verification failed.</p>
				<a href="/verify-email" class="btn">Request New Verification Link</a>
			</div>
		</div>
	);
}

export const verifyEmailConfirmScript = `(function() {
	var loadingEl = document.getElementById('loading');
	var successEl = document.getElementById('success');
	var errorEl = document.getElementById('error');
	var errorMsgEl = document.getElementById('error-message');

	function showSuccess() {
		loadingEl.classList.add('hidden');
		successEl.classList.remove('hidden');

		// Redirect to login after 3 seconds
		setTimeout(function() {
			window.location.href = '/login';
		}, 3000);
	}

	function showError(message) {
		loadingEl.classList.add('hidden');
		errorMsgEl.textContent = message;
		errorEl.classList.remove('hidden');
	}

	// Get token from URL
	var params = new URLSearchParams(window.location.search);
	var token = params.get('token');

	if (!token) {
		showError('No verification token provided.');
		return;
	}

	// Submit token to API
	fetch('/api/auth/verify-email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: token }),
		credentials: 'same-origin'
	})
	.then(function(res) {
		return res.json().then(function(data) {
			return { ok: res.ok, data: data };
		});
	})
	.then(function(result) {
		if (result.ok) {
			showSuccess();
		} else {
			showError(result.data.error || 'Verification failed.');
		}
	})
	.catch(function() {
		showError('Network error. Please try again.');
	});
})();`;
