/**
 * Verify email page - shown after signup
 */
import type { JSX } from 'preact';

export function VerifyEmailContent(): JSX.Element {
	return (
		<div class="auth-container">
			<h1>Check Your Email</h1>

			<div id="message" class="message-box hidden" />

			<p class="description">
				We've sent a verification link to your email address. Please click the link to verify your account.
			</p>

			<p class="note">
				The link will expire in 1 hour.
			</p>

			<div class="resend-section">
				<p>Didn't receive the email?</p>
				<form id="resend-form">
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
					<button type="submit" id="resend-btn">Resend Verification Email</button>
				</form>
			</div>

			<div class="back-link">
				<a href="/login">Back to Sign In</a>
			</div>
		</div>
	);
}

export const verifyEmailScript = `(function() {
	var form = document.getElementById('resend-form');
	var messageEl = document.getElementById('message');
	var resendBtn = document.getElementById('resend-btn');
	var emailInput = document.getElementById('email');

	// Pre-fill email from URL param if provided
	var params = new URLSearchParams(window.location.search);
	var emailParam = params.get('email');
	if (emailParam) {
		emailInput.value = emailParam;
	}

	function showMessage(text, isError) {
		messageEl.textContent = text;
		messageEl.classList.remove('hidden', 'success', 'error');
		messageEl.classList.add(isError ? 'error' : 'success');
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();

		var email = emailInput.value;

		resendBtn.disabled = true;
		resendBtn.textContent = 'Sending...';

		fetch('/api/auth/resend-verification', {
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
			showMessage(result.data.message || 'Verification email sent!', !result.ok);
			resendBtn.disabled = false;
			resendBtn.textContent = 'Resend Verification Email';
		})
		.catch(function() {
			showMessage('Network error. Please try again.', true);
			resendBtn.disabled = false;
			resendBtn.textContent = 'Resend Verification Email';
		});
	});
})();`;
