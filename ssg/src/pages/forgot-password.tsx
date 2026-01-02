/**
 * Forgot password page
 */
import type { JSX } from 'preact';

export function ForgotPasswordContent(): JSX.Element {
	return (
		<div class="auth-container">
			<h1>Reset Password</h1>

			<div id="message" class="message-box hidden" />

			<p class="description">
				Enter your email address and we'll send you a link to reset your password.
			</p>

			<form id="forgot-form">
				<div class="form-group">
					<label for="email">Email Address</label>
					<input
						type="email"
						id="email"
						name="email"
						required
						autocomplete="email"
					/>
				</div>

				<button type="submit" id="submit-btn">Send Reset Link</button>
			</form>

			<div class="back-link">
				<a href="/login">Back to Sign In</a>
			</div>
		</div>
	);
}

export const forgotPasswordScript = `(function() {
	var form = document.getElementById('forgot-form');
	var messageEl = document.getElementById('message');
	var submitBtn = document.getElementById('submit-btn');

	function showMessage(text, isError) {
		messageEl.textContent = text;
		messageEl.classList.remove('hidden', 'success', 'error');
		messageEl.classList.add(isError ? 'error' : 'success');
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();

		var email = document.getElementById('email').value;

		submitBtn.disabled = true;
		submitBtn.textContent = 'Sending...';

		fetch('/api/auth/forgot-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: email }),
			credentials: 'same-origin'
		})
		.then(function(res) {
			return res.json().then(function(data) {
				return { ok: res.ok, data: data };
			});
		})
		.then(function(result) {
			// Always show success message to prevent email enumeration
			showMessage(result.data.message || 'If an account exists with this email, a password reset link has been sent.', false);
			submitBtn.disabled = false;
			submitBtn.textContent = 'Send Reset Link';
		})
		.catch(function() {
			showMessage('Network error. Please try again.', true);
			submitBtn.disabled = false;
			submitBtn.textContent = 'Send Reset Link';
		});
	});
})();`;
