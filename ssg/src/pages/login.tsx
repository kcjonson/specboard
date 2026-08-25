/**
 * Login page content component
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

export function LoginContent(): JSX.Element {
	return (
		<div class="login-container">
			<div class="auth-brand">
				<BrandLogo size={32} href="/" />
			</div>

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
							autocomplete="username webauthn"
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

					<div class="signin-actions">
						<button type="submit" id="submit-btn">Sign In</button>
						<button type="button" id="magic-link-btn" class="secondary">
							Email me a sign-in code
						</button>
					</div>
				</form>

				<div class="method-divider"><span>or</span></div>

				<button type="button" id="passkey-btn" class="secondary hidden">
					Sign in with a passkey
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

			<div class="login-footer">
				<a href="/forgot-password" class="footer-link">Forgot your password?</a>
				<div class="signup-link">
					Don't have an account? <a href="/signup">Create one</a>
				</div>
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

	function showCodeView() {
		passwordSection.classList.add('hidden');
		codeSection.classList.remove('hidden');
		codeInput.focus();
		// Make the password -> code switch a real history entry so the browser
		// Back button returns to the password view instead of leaving /login.
		// Same URL (no email in the query — privacy), just a marker state.
		history.pushState({ loginView: 'code' }, '');
	}

	function showPasswordView() {
		hideError();
		codeSection.classList.add('hidden');
		passwordSection.classList.remove('hidden');
	}

	// Back/forward returns to the password view when the code view is showing,
	// rather than navigating away from the page.
	window.addEventListener('popstate', function() {
		if (!codeSection.classList.contains('hidden')) {
			showPasswordView();
		}
	});

	function getReturnUrl() {
		var params = new URLSearchParams(window.location.search);
		var next = params.get('next');
		if (!next) return '/';

		try {
			var url = new URL(next, window.location.origin);
			if (url.origin !== window.location.origin) {
				return '/';
			}
			// A scheme-relative pathname ('//host' or '/\\host', which URL
			// normalizes to '//host') passes the origin check but navigates
			// off-site when assigned to location.href.
			if (url.pathname.indexOf('//') === 0) {
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
				showCodeView();
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
		// Go back through history so this link and the browser Back button take
		// the same path (consuming the pushed code-view entry); popstate restores
		// the password view.
		history.back();
	});

	// --- Passkey (WebAuthn) sign-in ---
	var passkeyBtn = document.getElementById('passkey-btn');
	// Shared so the explicit button can cancel a pending conditional-UI get()
	// deterministically, rather than relying on listener-registration order.
	var conditionalController = null;

	function b64urlToBuf(value) {
		var base64 = value.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4) base64 += '=';
		var binary = atob(base64);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes.buffer;
	}

	function bufToB64url(buffer) {
		var bytes = new Uint8Array(buffer);
		var binary = '';
		for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
	}

	function passkeySupported() {
		return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get);
	}

	// Fetch a challenge, run the assertion, return { challengeId, credential }.
	function passkeyAssert(mediation, signal) {
		return fetch('/api/auth/webauthn/login/options', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin'
		})
		.then(parseJson)
		.then(function(result) {
			if (!result.ok) throw new Error('options_failed');
			var opts = result.data.options;
			var publicKey = {
				challenge: b64urlToBuf(opts.challenge),
				rpId: opts.rpId,
				timeout: opts.timeout,
				userVerification: opts.userVerification,
				allowCredentials: (opts.allowCredentials || []).map(function(c) {
					return { type: 'public-key', id: b64urlToBuf(c.id), transports: c.transports };
				}),
				extensions: opts.extensions
			};
			var getOptions = { publicKey: publicKey };
			if (mediation) getOptions.mediation = mediation;
			if (signal) getOptions.signal = signal;
			return navigator.credentials.get(getOptions).then(function(credential) {
				// get() can resolve to null (no discoverable credential). Treat it
				// like a cancel — tagged NotAllowedError so both the button and the
				// conditional flow stay silent — instead of letting passkeyVerify
				// read .response off null and surface a noisy generic failure.
				if (!credential) {
					var noCredential = new Error('No credential available');
					noCredential.name = 'NotAllowedError';
					throw noCredential;
				}
				return { challengeId: result.data.challengeId, credential: credential };
			});
		});
	}

	function passkeyVerify(challengeId, credential) {
		var r = credential.response;
		var assertion = {
			clientDataJSON: bufToB64url(r.clientDataJSON),
			authenticatorData: bufToB64url(r.authenticatorData),
			signature: bufToB64url(r.signature)
		};
		// Omit userHandle when absent (matches the platform JSON form) rather than
		// sending a literal null.
		if (r.userHandle) {
			assertion.userHandle = bufToB64url(r.userHandle);
		}
		var response = {
			id: credential.id,
			rawId: bufToB64url(credential.rawId),
			type: credential.type,
			clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
			response: assertion
		};
		if (credential.authenticatorAttachment) {
			response.authenticatorAttachment = credential.authenticatorAttachment;
		}
		return fetch('/api/auth/webauthn/login/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ challengeId: challengeId, response: response }),
			credentials: 'same-origin'
		}).then(parseJson);
	}

	// Explicit "Sign in with a passkey" button, revealed only when supported.
	if (passkeyBtn && passkeySupported()) {
		passkeyBtn.classList.remove('hidden');
		passkeyBtn.addEventListener('click', function() {
			hideError();
			// Cancel any in-flight conditional-UI get() before starting a fresh one.
			if (conditionalController) conditionalController.abort();
			passkeyBtn.disabled = true;
			passkeyBtn.textContent = 'Waiting for passkey...';
			passkeyAssert(null, null)
			.then(function(r) { return passkeyVerify(r.challengeId, r.credential); })
			.then(function(result) {
				if (result.ok) {
					window.location.href = getReturnUrl();
				} else {
					showError(result.data.error || 'Passkey sign-in failed.');
					passkeyBtn.disabled = false;
					passkeyBtn.textContent = 'Sign in with a passkey';
				}
			})
			.catch(function(err) {
				passkeyBtn.disabled = false;
				passkeyBtn.textContent = 'Sign in with a passkey';
				// NotAllowedError = user cancelled/timed out; AbortError = we aborted. Stay quiet.
				if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
					showError('Passkey sign-in failed.');
				}
			});
		});
	}

	// Conditional-UI autofill: offer discoverable passkeys in the username field's
	// autocomplete dropdown, without a click. Aborted if the user chooses another method.
	if (passkeySupported() && window.PublicKeyCredential.isConditionalMediationAvailable) {
		window.PublicKeyCredential.isConditionalMediationAvailable().then(function(available) {
			if (!available) return;
			conditionalController = new AbortController();
			form.addEventListener('submit', function() { conditionalController.abort(); });
			magicLinkBtn.addEventListener('click', function() { conditionalController.abort(); });
			passkeyAssert('conditional', conditionalController.signal)
			.then(function(r) { return passkeyVerify(r.challengeId, r.credential); })
			.then(function(result) {
				if (result.ok) {
					window.location.href = getReturnUrl();
				} else {
					// A completed assertion the server rejected — most reachably, the
					// challenge expired while the tab sat idle. Surface it instead of a
					// silent dead-end. Cancel / no-credential arrive via .catch and stay quiet.
					showError(result.data.error || 'Passkey sign-in did not complete. Please try again.');
				}
			})
			.catch(function() { /* aborted, cancelled, or no discoverable credential */ });
		}).catch(function() { /* isConditionalMediationAvailable unsupported */ });
	}
})();`;
