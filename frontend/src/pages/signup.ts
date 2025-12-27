/**
 * Server-rendered signup page
 * Pure HTML/CSS/JS - no dependencies
 */

export interface SignupPageOptions {
	error?: string;
	errors?: Array<{ code: string; message: string }>;
	username?: string;
	email?: string;
	firstName?: string;
	lastName?: string;
}

export function renderSignupPage(options: SignupPageOptions = {}): string {
	const { error, errors, username = '', email = '', firstName = '', lastName = '' } = options;
	const firstError = errors?.[0];
	const errorMessage = error || (firstError ? firstError.message : '');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Sign Up - Doc Platform</title>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: #f5f5f5;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 1rem;
		}

		.signup-container {
			background: white;
			border-radius: 8px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			padding: 2rem;
			width: 100%;
			max-width: 400px;
		}

		h1 {
			font-size: 1.5rem;
			font-weight: 600;
			margin-bottom: 1.5rem;
			text-align: center;
			color: #333;
		}

		.form-group {
			margin-bottom: 1rem;
		}

		.form-row {
			display: flex;
			gap: 1rem;
		}

		.form-row .form-group {
			flex: 1;
		}

		label {
			display: block;
			font-size: 0.875rem;
			font-weight: 500;
			margin-bottom: 0.5rem;
			color: #555;
		}

		input {
			width: 100%;
			padding: 0.75rem;
			font-size: 1rem;
			border: 1px solid #ddd;
			border-radius: 4px;
			transition: border-color 0.15s;
		}

		input:focus {
			outline: none;
			border-color: #0066cc;
		}

		button {
			width: 100%;
			padding: 0.75rem;
			font-size: 1rem;
			font-weight: 500;
			color: white;
			background: #0066cc;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			transition: background 0.15s;
		}

		button:hover {
			background: #0052a3;
		}

		button:disabled {
			background: #999;
			cursor: not-allowed;
		}

		.error {
			background: #fee;
			border: 1px solid #fcc;
			color: #c00;
			padding: 0.75rem;
			border-radius: 4px;
			margin-bottom: 1rem;
			font-size: 0.875rem;
		}

		.error.hidden {
			display: none;
		}

		.password-hint {
			font-size: 0.75rem;
			color: #666;
			margin-top: 0.25rem;
		}

		.login-link {
			text-align: center;
			margin-top: 1.5rem;
			font-size: 0.875rem;
			color: #666;
		}

		.login-link a {
			color: #0066cc;
			text-decoration: none;
		}

		.login-link a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="signup-container">
		<h1>Create Account</h1>

		<div id="error" class="error${errorMessage ? '' : ' hidden'}">${errorMessage ? escapeHtml(errorMessage) : ''}</div>

		<form id="signup-form">
			<div class="form-row">
				<div class="form-group">
					<label for="first_name">First Name</label>
					<input
						type="text"
						id="first_name"
						name="first_name"
						value="${escapeHtml(firstName)}"
						required
						autocomplete="given-name"
					>
				</div>

				<div class="form-group">
					<label for="last_name">Last Name</label>
					<input
						type="text"
						id="last_name"
						name="last_name"
						value="${escapeHtml(lastName)}"
						required
						autocomplete="family-name"
					>
				</div>
			</div>

			<div class="form-group">
				<label for="username">Username</label>
				<input
					type="text"
					id="username"
					name="username"
					value="${escapeHtml(username)}"
					required
					autocomplete="username"
					pattern="[a-zA-Z0-9_]{3,30}"
					title="3-30 characters, letters, numbers, and underscores only"
				>
			</div>

			<div class="form-group">
				<label for="email">Email</label>
				<input
					type="email"
					id="email"
					name="email"
					value="${escapeHtml(email)}"
					required
					autocomplete="email"
				>
			</div>

			<div class="form-group">
				<label for="password">Password</label>
				<input
					type="password"
					id="password"
					name="password"
					required
					autocomplete="new-password"
					minlength="12"
				>
				<div class="password-hint">
					At least 12 characters with uppercase, lowercase, number, and special character
				</div>
			</div>

			<button type="submit" id="submit-btn">Create Account</button>
		</form>

		<div class="login-link">
			Already have an account? <a href="/login">Sign in</a>
		</div>

	</div>

	<script>
		(function() {
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
						last_name: last_name
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
		})();
	</script>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
