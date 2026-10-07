/**
 * Signup page content component
 *
 * Email-only: collects an email and invite key, then swaps inline to a
 * check-your-email state with a code input. First sign-in happens via the
 * emailed magic link or code; profile details are collected in onboarding.
 *
 * Opened from a project invitation (/signup?invite=<token>), the invitation stands
 * in for the invite key and the account is for the invited address, which shows
 * masked and locked. The page never learns the full address: a typed code is sent
 * with the invitation token and the server looks the address up. Signing in then
 * lands back on the invite.
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';
import { safeNextScript } from '../scripts/safe-next';

export function SignupContent(): JSX.Element {
	return (
		<div class="signup-container">
			<div class="auth-brand">
				<BrandLogo size={40} href="/" />
			</div>

			<h1>Create Account</h1>

			<div id="error" class="error-message hidden" />

			<p id="invite-intro" class="invite-intro hidden" />

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

					<div class="form-group" id="invite-key-group">
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
				Already have an account? <a href="/login" id="login-link">Sign in</a>
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
	var emailInput = document.getElementById('email');
	var inviteKeyGroup = document.getElementById('invite-key-group');
	var inviteKeyInput = document.getElementById('invite_key');
	var inviteIntro = document.getElementById('invite-intro');
	var loginLink = document.getElementById('login-link');
	var pendingEmail = null;

	${safeNextScript}

	// Capture UTM and referral parameters from the URL for acquisition tracking
	var params = new URLSearchParams(window.location.search);
	var utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referral_source'];
	var utmData = {};
	utmFields.forEach(function(field) {
		var val = params.get(field);
		if (val) utmData[field] = val;
	});

	// A project invitation in place of the invite key: the account is for the invited address
	var inviteToken = params.get('invite');

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

	if (inviteToken) {
		inviteKeyGroup.classList.add('hidden');
		inviteKeyInput.required = false;
		emailInput.disabled = true;
		submitBtn.disabled = true;

		fetch('/api/invite?token=' + encodeURIComponent(inviteToken), { credentials: 'same-origin' })
		.then(parseJson)
		.then(function(result) {
			if (result.ok && result.data.state === 'open') {
				inviteIntro.textContent = result.data.inviterName + ' invited you to ' + result.data.projectName +
					'. Create your account with the address the invite was sent to.';
				inviteIntro.classList.remove('hidden');
				emailInput.value = result.data.email;
				loginLink.href = '/login?next=' + encodeURIComponent('/invite?id=' + result.data.id);
				submitBtn.disabled = false;
			} else {
				showError('This invite is no longer valid. Ask whoever invited you to send a new one.');
			}
		})
		.catch(function() {
			showError('Network error. Please reload the page.');
		});
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();
		hideError();

		submitBtn.disabled = true;
		submitBtn.textContent = 'Creating account...';

		// Merge whitelisted UTM/referral data with form fields (form values take precedence for overlapping keys)
		var fields = inviteToken
			? { invite_token: inviteToken }
			: { email: emailInput.value.trim(), invite_key: inviteKeyInput.value };
		var body = Object.assign({}, utmData, fields);

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
				// Masked when an invitation opened the signup; the code then goes with the token.
				pendingEmail = result.data.email;
				codeEmailEl.textContent = result.data.email;
				signupSection.classList.add('hidden');
				inviteIntro.classList.add('hidden');
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
			body: JSON.stringify(inviteToken
				? { invite_token: inviteToken, code: codeInput.value }
				: { email: pendingEmail, code: codeInput.value }),
			credentials: 'same-origin'
		})
		.then(parseJson)
		.then(function(result) {
			if (result.ok) {
				window.location.href = safeNext(result.data.next);
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
