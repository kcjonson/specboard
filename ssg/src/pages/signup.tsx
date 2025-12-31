/**
 * Signup page content component
 */
import type { JSX } from 'preact';

export function SignupContent(): JSX.Element {
	return (
		<div class="signup-container">
			<h1>Create Account</h1>

			<div id="error" class="error-message hidden" />

			<form id="signup-form">
				<div class="form-row">
					<div class="form-group">
						<label for="first_name">First Name</label>
						<input
							type="text"
							id="first_name"
							name="first_name"
							required
							autocomplete="given-name"
						/>
					</div>

					<div class="form-group">
						<label for="last_name">Last Name</label>
						<input
							type="text"
							id="last_name"
							name="last_name"
							required
							autocomplete="family-name"
						/>
					</div>
				</div>

				<div class="form-group">
					<label for="username">Username</label>
					<input
						type="text"
						id="username"
						name="username"
						required
						autocomplete="username"
						pattern="[a-zA-Z0-9_]{3,30}"
						title="3-30 characters, letters, numbers, and underscores only"
					/>
				</div>

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

				<div class="form-group">
					<label for="password">Password</label>
					<input
						type="password"
						id="password"
						name="password"
						required
						autocomplete="new-password"
						minlength={12}
					/>
					<div class="password-hint">
						At least 12 characters
					</div>
				</div>

				<button type="submit" id="submit-btn">Create Account</button>
			</form>

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

	function showError(message) {
		errorEl.textContent = message;
		errorEl.classList.remove('hidden');
	}

	function hideError() {
		errorEl.classList.add('hidden');
	}

	form.addEventListener('submit', function(e) {
		e.preventDefault();
		hideError();

		var first_name = document.getElementById('first_name').value;
		var last_name = document.getElementById('last_name').value;
		var username = document.getElementById('username').value;
		var email = document.getElementById('email').value;
		var invite_key = document.getElementById('invite_key').value;
		var password = document.getElementById('password').value;

		submitBtn.disabled = true;
		submitBtn.textContent = 'Creating account...';

		fetch('/api/auth/signup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: username,
				email: email,
				password: password,
				first_name: first_name,
				last_name: last_name,
				invite_key: invite_key
			}),
			credentials: 'same-origin'
		})
		.then(function(res) {
			return res.json().then(function(data) {
				return { ok: res.ok, data: data };
			});
		})
		.then(function(result) {
			if (result.ok) {
				window.location.href = '/';
			} else {
				showError(result.data.error || 'Signup failed');
				submitBtn.disabled = false;
				submitBtn.textContent = 'Create Account';
			}
		})
		.catch(function() {
			showError('Network error. Please try again.');
			submitBtn.disabled = false;
			submitBtn.textContent = 'Create Account';
		});
	});
})();`;
