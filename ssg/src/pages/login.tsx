/**
 * Login page content component
 */
import type { JSX } from 'preact';

export function LoginContent(): JSX.Element {
	return (
		<div class="login-container">
			<h1>Sign In</h1>

			<div id="error" class="error-message hidden" />

			<div id="password-section">
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

				<div class="method-divider"><span>or</span></div>

				<button type="button" id="magic-link-btn" class="secondary">
					Email me a sign-in code
				</button>
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

				<div class="code-links">
					<a href="#" id="code-resend">Resend code</a>
					<a href="#" id="code-back">Back to password sign-in</a>
				</div>
			</div>

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
	var passwordSection = document.getElementById('password-section');
	var codeSection = document.getElementById('code-section');
	var magicLinkBtn = document.getElementById('magic-link-btn');
	var codeForm = document.getElementById('code-form');
	var codeInput = document.getElementById('code');
	var codeVerifyBtn = document.getElementById('code-verify-btn');
	var codeEmailEl = document.getElementById('code-email');
	var resendLink = document.getElementById('code-resend');
	var backLink = document.getElementById('code-back');
	var pendingEmail = null;

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

	function isEmail(value) {
		return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
	}

	function parseJson(res) {
		return res.json().then(function(data) {
			return { ok: res.ok, data: data };
		});
	}

	function requestCode(email) {
		var body = { email: email };
		var next = getReturnUrl();
		if (next !== '/') {
			body.next = next;
		}
		return fetch('/api/auth/magic-link/request', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		}).then(parseJson);
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
		.then(parseJson)
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

	magicLinkBtn.addEventListener('click', function() {
		hideError();

		var email = document.getElementById('identifier').value.trim();
		if (!isEmail(email)) {
			showError('Enter your email address above to receive a sign-in code.');
			return;
		}

		magicLinkBtn.disabled = true;
		magicLinkBtn.textContent = 'Sending...';

		requestCode(email)
		.then(function(result) {
			magicLinkBtn.disabled = false;
			magicLinkBtn.textContent = 'Email me a sign-in code';
			if (result.ok) {
				pendingEmail = email;
				codeEmailEl.textContent = email;
				passwordSection.classList.add('hidden');
				codeSection.classList.remove('hidden');
				codeInput.focus();
			} else {
				showError(result.data.error || 'Could not send a sign-in code. Please try again.');
			}
		})
		.catch(function() {
			magicLinkBtn.disabled = false;
			magicLinkBtn.textContent = 'Email me a sign-in code';
			showError('Network error. Please try again.');
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
				window.location.href = getReturnUrl();
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

	resendLink.addEventListener('click', function(e) {
		e.preventDefault();
		hideError();
		resendLink.textContent = 'Sending...';

		requestCode(pendingEmail)
		.then(function(result) {
			resendLink.textContent = 'Resend code';
			if (!result.ok) {
				showError(result.data.error || 'Could not resend the code. Please try again.');
			}
		})
		.catch(function() {
			resendLink.textContent = 'Resend code';
			showError('Network error. Please try again.');
		});
	});

	backLink.addEventListener('click', function(e) {
		e.preventDefault();
		hideError();
		codeSection.classList.add('hidden');
		passwordSection.classList.remove('hidden');
	});
})();`;
