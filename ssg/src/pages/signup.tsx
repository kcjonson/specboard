/**
 * Signup page content component
 *
 * Email-only: collects an email and invite key, then swaps inline to a
 * check-your-email state with a code input. First sign-in happens via the
 * emailed magic link or code; profile details are collected in onboarding.
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

export function SignupContent(): JSX.Element {
	return (
		<div class="signup-container">
			<div class="auth-brand">
				<BrandLogo size={26} href="/" />
			</div>

			<h1>Create Account</h1>

			<div id="error" class="error-message hidden" />

			<div id="signup-section">
				<form id="signup-form">
					<div class="form-group">
						<label for="email">Email</label>
						<input
							type="email"
							id="email"
							name="email"
							required
							autocomplete="email"
						/>
					</div>

					<div class="form-group">
						<label for="invite_key">Invite Key</label>
						<input
							type="text"
							id="invite_key"
							name="invite_key"
							required
							autocomplete="off"
						/>
						<div class="invite-hint">
							Required for early access
						</div>
					</div>

					<button type="submit" id="submit-btn">Create Account</button>
				</form>
			</div>

			<div id="code-section" class="hidden">
				<p class="code-intro">
					We sent a sign-in code to <strong id="code-email" />.
					Click the link in the email, or enter the code here.
				</p>

				<form id="code-form">
					<div class="form-group">
						<label for="code">Sign-in code</label>
						<input
							type="text"
							id="code"
							name="code"
							autocomplete="one-time-code"
							maxlength={9}
							placeholder="XXXX-XXXX"
						/>
					</div>

					<button type="submit" id="code-verify-btn">Verify Code</button>
				</form>
			</div>

			<div class="login-link">
				Already have an account? <a href="/login">Sign in</a>
			</div>
		</div>
	);
}

export const signupScript = `(function() {
	var form = document.getElementById('signup-form');
	var errorEl = document.getElementById('error');
	var submitBtn = document.getElementById('submit-btn');
	var signupSection = document.getElementById('signup-section');
	var codeSection = document.getElementById('code-section');
	var codeForm = document.getElementById('code-form');
	var codeInput = document.getElementById('code');
	var codeVerifyBtn = document.getElementById('code-verify-btn');
	var codeEmailEl = document.getElementById('code-email');
	var pendingEmail = null;

	// Capture UTM and referral parameters from the URL for acquisition tracking
	var params = new URLSearchParams(window.location.search);
	var utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referral_source'];
	var utmData = {};
	utmFields.forEach(function(field) {
		var val = params.get(field);
		if (val) utmData[field] = val;
	});

	function showError(message) {
		errorEl.textContent = message;
		errorEl.classList.remove('hidden');
	}

	function hideError() {
		errorEl.classList.add('hidden');
	}

	function parseJson(res) {
		return res.json().then(function(data) {
			return { ok: res.ok, data: data };
		});
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();
		hideError();

		var email = document.getElementById('email').value.trim();
		var invite_key = document.getElementById('invite_key').value;

		submitBtn.disabled = true;
		submitBtn.textContent = 'Creating account...';

		// Merge whitelisted UTM/referral data with form fields (form values take precedence for overlapping keys)
		var body = Object.assign({}, utmData, {
			email: email,
			invite_key: invite_key
		});

		fetch('/api/auth/signup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		})
		.then(parseJson)
		.then(function(result) {
			submitBtn.disabled = false;
			submitBtn.textContent = 'Create Account';
			if (result.ok) {
				pendingEmail = email;
				codeEmailEl.textContent = email;
				signupSection.classList.add('hidden');
				codeSection.classList.remove('hidden');
				codeInput.focus();
			} else {
				showError(result.data.error || 'Signup failed');
			}
		})
		.catch(function() {
			showError('Network error. Please try again.');
			submitBtn.disabled = false;
			submitBtn.textContent = 'Create Account';
		});
	});

	codeForm.addEventListener('submit', function(e) {
		e.preventDefault();
		hideError();

		codeVerifyBtn.disabled = true;
		codeVerifyBtn.textContent = 'Verifying...';

		fetch('/api/auth/magic-link/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: pendingEmail, code: codeInput.value }),
			credentials: 'same-origin'
		})
		.then(parseJson)
		.then(function(result) {
			if (result.ok) {
				window.location.href = '/';
			} else {
				showError(result.data.error || 'Verification failed');
				codeVerifyBtn.disabled = false;
				codeVerifyBtn.textContent = 'Verify Code';
			}
		})
		.catch(function() {
			showError('Network error. Please try again.');
			codeVerifyBtn.disabled = false;
			codeVerifyBtn.textContent = 'Verify Code';
		});
	});
})();`;
