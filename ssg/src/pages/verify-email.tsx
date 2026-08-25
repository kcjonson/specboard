/**
 * Verify email page - shown after signup
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

export function VerifyEmailContent(): JSX.Element {
	return (
		<div class="auth-container">
			<div class="auth-brand">
				<BrandLogo size={18} href="/" />
			</div>

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
				<p id="email-display" class="email-display" />
				<button type="button" id="resend-btn">Resend Verification Email</button>
			</div>

			<div class="back-link">
				<a href="/login">Back to Sign In</a>
			</div>
		</div>
	);
}

export const verifyEmailScript = `(function() {
	var messageEl = document.getElementById('message');
	var resendBtn = document.getElementById('resend-btn');
	var emailDisplay = document.getElementById('email-display');

	var params = new URLSearchParams(window.location.search);
	var email = params.get('email');

	if (!email) {
		// No email param - hide resend section
		document.querySelector('.resend-section').classList.add('hidden');
		return;
	}

	emailDisplay.textContent = email;

	function showMessage(text, isError) {
		messageEl.textContent = text;
		messageEl.classList.remove('hidden', 'success', 'error');
		messageEl.classList.add(isError ? 'error' : 'success');
	}

	resendBtn.addEventListener('click', function() {
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
