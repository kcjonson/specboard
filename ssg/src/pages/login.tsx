/**
 * Login page content component
 */
import type { JSX } from 'preact';

export function LoginContent(): JSX.Element {
	return (
		<div class="login-container">
			<h1>Sign In</h1>

			<div id="error" class="error-message hidden" />

			<form id="login-form">
				<div class="form-group">
					<label for="identifier">Username or Email</label>
					<input
						type="text"
						id="identifier"
						name="identifier"
						required
						autocomplete="username"
					/>
				</div>

				<div class="form-group">
					<label for="password">Password</label>
					<input
						type="password"
						id="password"
						name="password"
						required
						autocomplete="current-password"
					/>
				</div>

				<div class="forgot-password">
					<a href="/forgot-password">Forgot your password?</a>
				</div>

				<button type="submit" id="submit-btn">Sign In</button>
			</form>

			<div class="signup-link">
				Don't have an account? <a href="/signup">Create one</a>
			</div>
		</div>
	);
}

export const loginScript = `(function() {
	var form = document.getElementById('login-form');
	var errorEl = document.getElementById('error');
	var submitBtn = document.getElementById('submit-btn');

	function showError(message) {
		errorEl.textContent = message;
		errorEl.classList.remove('hidden');
	}

	function hideError() {
		errorEl.classList.add('hidden');
	}

	function getReturnUrl() {
		var params = new URLSearchParams(window.location.search);
		var next = params.get('next');
		if (!next) return '/';

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

	form.addEventListener('submit', function(e) {
		e.preventDefault();
		hideError();

		var identifier = document.getElementById('identifier').value;
		var password = document.getElementById('password').value;

		submitBtn.disabled = true;
		submitBtn.textContent = 'Signing in...';

		fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identifier: identifier, password: password }),
			credentials: 'same-origin'
		})
		.then(function(res) {
			return res.json().then(function(data) {
				return { ok: res.ok, data: data };
			});
		})
		.then(function(result) {
			if (result.ok) {
				window.location.href = getReturnUrl();
			} else {
				// If email not verified, redirect to verify-email page
				if (result.data.email_not_verified && result.data.email) {
					window.location.href = '/verify-email?email=' + encodeURIComponent(result.data.email);
					return;
				}
				showError(result.data.error || 'Login failed');
				submitBtn.disabled = false;
				submitBtn.textContent = 'Sign In';
			}
		})
		.catch(function() {
			showError('Network error. Please try again.');
			submitBtn.disabled = false;
			submitBtn.textContent = 'Sign In';
		});
	});
})();`;
