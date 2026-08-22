/**
 * Magic link landing page - consumes the token from the emailed sign-in link.
 * The token is submitted via fetch rather than a GET side effect so email
 * scanners that prefetch URLs don't consume it.
 */
import type { JSX } from 'preact';

export function MagicLinkContent(): JSX.Element {
	return (
		<div class="auth-container">
			<h1>Signing You In...</h1>

			<div id="loading" class="loading-state">
				<p>Please wait while we sign you in.</p>
			</div>

			<div id="success" class="result-state hidden">
				<div class="success-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</div>
				<p>You're signed in!</p>
				<p class="redirect-note">Redirecting...</p>
			</div>

			<div id="error" class="result-state hidden">
				<div class="error-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</div>
				<p id="error-message">Sign in failed.</p>
				<a href="/login" class="btn">Request a New Code</a>
			</div>
		</div>
	);
}

export const magicLinkScript = `(function() {
	var loadingEl = document.getElementById('loading');
	var successEl = document.getElementById('success');
	var errorEl = document.getElementById('error');
	var errorMsgEl = document.getElementById('error-message');

	function validateNext(next) {
		if (typeof next !== 'string' || !next) return '/';
		try {
			var url = new URL(next, window.location.origin);
			if (url.origin !== window.location.origin) {
				return '/';
			}
			return url.pathname + url.search + url.hash;
		} catch (e) {
			return '/';
		}
	}

	function showSuccess(next) {
		loadingEl.classList.add('hidden');
		successEl.classList.remove('hidden');
		window.location.replace(validateNext(next));
	}

	function showError(message) {
		loadingEl.classList.add('hidden');
		errorMsgEl.textContent = message;
		errorEl.classList.remove('hidden');
	}

	var params = new URLSearchParams(window.location.search);
	var token = params.get('token');

	if (!token) {
		showError('This sign-in link is missing its token.');
		return;
	}

	fetch('/api/auth/magic-link/verify', {
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
			showSuccess(result.data.next);
		} else {
			showError(result.data.error || 'Sign in failed.');
		}
	})
	.catch(function() {
		showError('Network error. Please try again.');
	});
})();`;
