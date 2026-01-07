/**
 * Reset password page - processes the token from email link
 */
import type { JSX } from 'preact';

export function ResetPasswordContent(): JSX.Element {
	return (
		<div class="auth-container">
			<h1>Set New Password</h1>

			<div id="message" class="message-box hidden" />

			<div id="form-container">
				<p class="description">
					Enter your new password below.
				</p>

				<form id="reset-form">
					<div class="form-group">
						<label for="password">New Password</label>
						<input
							type="password"
							id="password"
							name="password"
							required
							minLength={12}
							autocomplete="new-password"
						/>
						<small class="hint">
							Must be at least 12 characters with uppercase, lowercase, number, and special character.
						</small>
					</div>

					<div class="form-group">
						<label for="confirm-password">Confirm Password</label>
						<input
							type="password"
							id="confirm-password"
							name="confirm-password"
							required
							minLength={12}
							autocomplete="new-password"
						/>
					</div>

					<button type="submit" id="submit-btn">Reset Password</button>
				</form>
			</div>

			<div id="success" class="result-state hidden">
				<div class="success-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12" />
					</svg>
				</div>
				<p>Your password has been reset!</p>
				<p class="redirect-note">Redirecting to sign in...</p>
				<a href="/login" class="btn">Go to Sign In</a>
			</div>

			<div id="no-token" class="result-state hidden">
				<div class="error-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</div>
				<p>No reset token provided.</p>
				<a href="/forgot-password" class="btn">Request Password Reset</a>
			</div>
		</div>
	);
}

export const resetPasswordScript = `(function() {
	var formContainer = document.getElementById('form-container');
	var form = document.getElementById('reset-form');
	var messageEl = document.getElementById('message');
	var submitBtn = document.getElementById('submit-btn');
	var successEl = document.getElementById('success');
	var noTokenEl = document.getElementById('no-token');

	// Get token from URL
	var params = new URLSearchParams(window.location.search);
	var token = params.get('token');

	if (!token) {
		formContainer.classList.add('hidden');
		noTokenEl.classList.remove('hidden');
		return;
	}

	function showMessage(text, isError) {
		messageEl.textContent = text;
		messageEl.classList.remove('hidden', 'success', 'error');
		messageEl.classList.add(isError ? 'error' : 'success');
	}

	function showSuccess() {
		formContainer.classList.add('hidden');
		messageEl.classList.add('hidden');
		successEl.classList.remove('hidden');

		// Redirect to login after 3 seconds
		setTimeout(function() {
			window.location.href = '/login';
		}, 3000);
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();

		var password = document.getElementById('password').value;
		var confirmPassword = document.getElementById('confirm-password').value;

		// Validate passwords match
		if (password !== confirmPassword) {
			showMessage('Passwords do not match.', true);
			return;
		}

		submitBtn.disabled = true;
		submitBtn.textContent = 'Resetting...';

		fetch('/api/auth/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: token, password: password }),
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
				showMessage(result.data.error || 'Password reset failed.', true);
				submitBtn.disabled = false;
				submitBtn.textContent = 'Reset Password';
			}
		})
		.catch(function() {
			showMessage('Network error. Please try again.', true);
			submitBtn.disabled = false;
			submitBtn.textContent = 'Reset Password';
		});
	});
})();`;
